/**
 * Chapters: parse creator chapters from the video description, or derive topic
 * segments from the transcript with a TextTiling-style algorithm
 * (time windows + lexical-cohesion "keyword shift" between adjacent windows).
 */
import {
  type Sentence,
  type Vec,
  addVec,
  cosine,
  countTerms,
  distinctiveTerms,
  idf,
  surfaceForms,
  textRank,
  tfidf,
} from "./text.js";
import { formatTimestamp, parseTimestamp, round, truncate, videoUrl } from "./util.js";

export interface RawChapter {
  title: string;
  start: number;
}

export interface Chapter {
  index: number;
  title: string;
  start: number;
  end: number;
  duration: number;
  startTime: string;
  url: string;
  /** Derived chapters only: distinctive keywords of the segment. */
  keywords?: string[];
  /** Derived chapters only: the segment's most central sentence. */
  summary?: string;
}

// ---------------------------------------------------------------------------
// Description chapters
// ---------------------------------------------------------------------------

const TS = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/;
const SEP = /^[\s\-–—:|•·*>.,]+|[\s\-–—:|•·*<.,]+$/g;

/**
 * Find timestamped lines such as "0:00 Intro", "Intro - 1:23", "(12:05) Q&A",
 * "1. 02:10 – Setup". Returns ascending chapters, or [] when the description
 * doesn't contain a usable list (needs ≥ 2 ascending timestamps, the first one
 * within the first 30 seconds as YouTube itself requires 0:00).
 */
export function parseDescriptionChapters(description: string, durationSeconds?: number | null): RawChapter[] {
  const found: RawChapter[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 200) continue;
    const m = line.match(TS);
    if (!m) continue;
    const start = parseTimestamp(m[0]);
    if (start === null) continue;
    let title = (line.slice(0, m.index) + " " + line.slice(m.index! + m[0].length))
      .replace(/(?<![\d:])(?:\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])/g, " ") // ranges like "0:00 - 1:30 Intro"
      .replace(/^\s*\d{1,2}[.)]\s+/, "") // list numbering "1. "
      .replace(/[(\[]\s*[)\]]/g, "") // "(12:05) Q&A" leaves empty brackets
      .replace(/\s+/g, " ")
      .replace(SEP, "")
      .trim();
    title = title.replace(/^[-–—:|]\s*/, "").trim();
    if (!title) continue;
    found.push({ title, start });
  }
  // Longest ascending run starting near 0.
  const startIdx = found.findIndex((c) => c.start <= 30);
  if (startIdx < 0) return [];
  const out: RawChapter[] = [];
  for (const c of found.slice(startIdx)) {
    const prev = out[out.length - 1];
    if (prev && c.start <= prev.start) {
      if (out.length >= 2) break; // second list (e.g. "songs used") — keep the first
      continue;
    }
    if (durationSeconds && c.start >= durationSeconds) break;
    out.push(c);
  }
  if (out.length < 2) return [];
  out[0] = { ...out[0]!, start: 0 };
  return out;
}

export function finalizeChapters(id: string, raw: RawChapter[], totalSeconds: number | null): Chapter[] {
  return raw.map((c, i) => {
    const next = raw[i + 1];
    const end = next ? next.start : Math.max(totalSeconds ?? c.start, c.start);
    return {
      index: i + 1,
      title: c.title,
      start: round(c.start, 2),
      end: round(end, 2),
      duration: round(end - c.start, 2),
      startTime: formatTimestamp(c.start),
      url: videoUrl(id, c.start),
    };
  });
}

// ---------------------------------------------------------------------------
// Derived chapters (TextTiling)
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  /** Desired chapter count; derived from duration when omitted. */
  targetChapters?: number;
  /** Do not create chapters shorter than this (seconds). */
  minChapterSeconds?: number;
}

function targetCount(duration: number): number {
  const per = duration < 900 ? 120 : duration < 3600 ? 240 : 480;
  return Math.max(1, Math.min(15, Math.round(duration / per)));
}

/**
 * 1. Cut the transcript into fixed time blocks (20-60 s, scaled to video length).
 * 2. For each block gap, compare the TF-IDF vectors of the 2 blocks before and
 *    after it; a low cosine = vocabulary changes = likely topic boundary.
 * 3. Depth score per gap (how far similarity dips below the surrounding peaks);
 *    pick the deepest gaps, respecting a minimum chapter length.
 * 4. If a chapter still exceeds ~2.2× the average length, split it at its
 *    deepest internal gap (pure time-window fallback).
 * 5. Snap boundaries to sentence starts; title each chapter with its most
 *    distinctive keywords and attach its most central sentence.
 */
export function deriveChapters(
  id: string,
  sentences: Sentence[],
  totalSeconds: number,
  opts: DeriveOptions = {},
): Chapter[] {
  if (!sentences.length) return [];
  const duration = Math.max(totalSeconds, sentences[sentences.length - 1]!.end);
  const target = opts.targetChapters ?? targetCount(duration);
  const avg = duration / target;
  const minLen = opts.minChapterSeconds ?? Math.max(30, avg * 0.4);
  const blockLen = Math.max(20, Math.min(60, duration / 40));
  const nBlocks = Math.max(1, Math.ceil(duration / blockLen));

  // Block term vectors.
  const blocks: Vec[] = Array.from({ length: nBlocks }, () => new Map());
  for (const s of sentences) addVec(blocks[Math.min(nBlocks - 1, Math.floor(s.start / blockLen))]!, countTerms(s.text));
  const w = idf(blocks.filter((b) => b.size));
  const vec = blocks.map((b) => tfidf(b, w));

  // Gap similarities (gap g lies between block g-1 and block g, at time g*blockLen).
  const K = 2;
  const sims: number[] = [];
  for (let g = 1; g < nBlocks; g++) {
    const left = new Map();
    const right = new Map();
    for (let i = Math.max(0, g - K); i < g; i++) addVec(left, vec[i]!);
    for (let i = g; i < Math.min(nBlocks, g + K); i++) addVec(right, vec[i]!);
    sims.push(cosine(left, right));
  }
  const depth = sims.map((s, i) => {
    let l = s;
    for (let j = i; j >= 0 && sims[j]! >= l; j--) l = sims[j]!;
    let r = s;
    for (let j = i; j < sims.length && sims[j]! >= r; j++) r = sims[j]!;
    return l - s + (r - s);
  });

  // Greedy boundary selection by depth.
  const gaps = depth.map((d, i) => ({ t: (i + 1) * blockLen, d })).sort((a, b) => b.d - a.d);
  const boundaries: number[] = [];
  const meanD = depth.reduce((a, b) => a + b, 0) / Math.max(1, depth.length);
  const ok = (t: number) => t >= minLen && duration - t >= minLen && boundaries.every((b) => Math.abs(b - t) >= minLen);
  for (const g of gaps) {
    if (boundaries.length >= target - 1) break;
    if (g.d <= 0 || g.d < meanD * 0.5) break;
    if (ok(g.t)) boundaries.push(g.t);
  }
  // Time-window fallback: split over-long chapters.
  for (let guard = 0; guard < 30; guard++) {
    const edges = [0, ...boundaries.sort((a, b) => a - b), duration];
    let longest = -1;
    for (let i = 0; i < edges.length - 1; i++) {
      if (edges[i + 1]! - edges[i]! > avg * 2.2 && (longest < 0 || edges[i + 1]! - edges[i]! > edges[longest + 1]! - edges[longest]!)) {
        longest = i;
      }
    }
    if (longest < 0) break;
    const [a, b] = [edges[longest]!, edges[longest + 1]!];
    const inside = gaps.filter((g) => g.t > a + minLen && g.t < b - minLen);
    const pick = inside[0]?.t ?? (a + b) / 2;
    boundaries.push(pick);
  }
  boundaries.sort((a, b) => a - b);

  // Snap to the nearest sentence start, then group sentences.
  const starts = sentences.map((s) => s.start);
  const snapped = [...new Set(boundaries.map((t) => nearest(starts, t)))].filter((t) => t > 0).sort((a, b) => a - b);
  const groups: Sentence[][] = [];
  let cur: Sentence[] = [];
  let bi = 0;
  for (const s of sentences) {
    if (bi < snapped.length && s.start >= snapped[bi]!) {
      if (cur.length) groups.push(cur);
      cur = [];
      while (bi < snapped.length && s.start >= snapped[bi]!) bi++;
    }
    cur.push(s);
  }
  if (cur.length) groups.push(cur);

  // Titles + summaries.
  const groupVecs = groups.map((g) => g.reduce((acc, s) => addVec(acc, countTerms(s.text)), new Map() as Vec));
  const raw = groups.map((g, i) => {
    const text = g.map((s) => s.text).join(" ");
    const forms = surfaceForms(text);
    const kws = distinctiveTerms(groupVecs[i]!, groupVecs.filter((_, j) => j !== i), 4).map((t) => forms.get(t) ?? t);
    const scores = textRank(g);
    const best = g[scores.indexOf(Math.max(...scores))] ?? g[0]!;
    return {
      start: i === 0 ? 0 : g[0]!.start,
      keywords: kws,
      title: titleFrom(kws, i),
      summary: truncate(best.text, 220),
    };
  });
  return finalizeChapters(id, raw, duration).map((c, i) => ({ ...c, keywords: raw[i]!.keywords, summary: raw[i]!.summary }));
}

function nearest(sorted: number[], t: number): number {
  let best = sorted[0] ?? t;
  for (const x of sorted) if (Math.abs(x - t) < Math.abs(best - t)) best = x;
  return best;
}

function titleFrom(keywords: string[], i: number): string {
  if (!keywords.length) return `Part ${i + 1}`;
  const words = keywords.slice(0, 3);
  const t = words.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
