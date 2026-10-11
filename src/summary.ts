/**
 * Extractive, structured transcript summary without an LLM:
 *  - key points: TextRank-ranked sentences, de-duplicated with MMR, in chronological order
 *  - keywords/keyphrases: frequency × window-IDF
 *  - per-chapter bullets: best sentences inside each chapter (creator chapters or derived)
 *  - quotes: quotable high-ranking lines with timestamps and deep links
 */
import { type Chapter, type RawChapter, deriveChapters, finalizeChapters } from "./chapters.js";
import {
  type Keyword,
  type Sentence,
  buildSentences,
  cosine,
  countTerms,
  extractKeywords,
  hasPunctuation,
  idf,
  textRank,
  tfidf,
} from "./text.js";
import type { Segment } from "./transcript.js";
import { segmentsEnd } from "./transcript.js";
import { formatTimestamp, round, truncate, videoUrl } from "./util.js";

export interface Point {
  text: string;
  start: number;
  timestamp: string;
  url: string;
  score: number;
}

export interface ChapterSummary extends Chapter {
  bullets: Point[];
}

export interface Summary {
  tldr: string;
  keyPoints: Point[];
  keywords: Keyword[];
  chapters: ChapterSummary[];
  chapterSource: "description" | "youtube" | "transcript";
  quotes: Point[];
  stats: {
    words: number;
    sentences: number;
    durationSeconds: number;
    wordsPerMinute: number | null;
    readingTimeMinutes: number;
    punctuated: boolean;
  };
}

export interface SummarizeOptions {
  maxPoints: number;
  bulletsPerChapter: number;
  maxQuotes: number;
  keywordLimit: number;
  /** Creator/YouTube chapters to summarize against; derived from the transcript when null. */
  chapters: RawChapter[] | null;
  chapterSource?: "description" | "youtube";
  durationSeconds: number | null;
}

function point(id: string, s: Sentence, score: number, maxChars = 320): Point {
  return {
    text: truncate(s.text, maxChars),
    start: round(s.start, 2),
    timestamp: formatTimestamp(s.start),
    url: videoUrl(id, s.start),
    score: round(score, 4),
  };
}

/**
 * Maximal Marginal Relevance: pick `k` items maximizing
 * λ·relevance − (1−λ)·max similarity to already-picked items.
 */
function mmr(candidates: number[], scores: number[], vecs: Map<string, number>[], k: number, lambda = 0.7): number[] {
  const maxScore = Math.max(...candidates.map((i) => scores[i]!), 1e-9);
  const picked: number[] = [];
  const pool = new Set(candidates);
  while (picked.length < k && pool.size) {
    let best = -1;
    let bestVal = -Infinity;
    for (const i of pool) {
      const rel = scores[i]! / maxScore;
      const red = picked.length ? Math.max(...picked.map((j) => cosine(vecs[i]!, vecs[j]!))) : 0;
      const val = lambda * rel - (1 - lambda) * red;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    }
    pool.delete(best);
    picked.push(best);
  }
  return picked;
}

export function summarize(id: string, segments: Segment[], opts: SummarizeOptions): Summary {
  const sentences = buildSentences(segments);
  const duration = Math.max(opts.durationSeconds ?? 0, segmentsEnd(segments));
  const scores = textRank(sentences);
  const counts = sentences.map((s) => countTerms(s.text));
  const weights = idf(counts);
  const vecs = counts.map((c) => tfidf(c, weights));
  const all = sentences.map((_, i) => i);
  const usable = all.filter((i) => sentences[i]!.words >= 6);

  // Key points: MMR over the whole transcript, then chronological order.
  const keyIdx = mmr(usable.length ? usable : all, scores, vecs, Math.min(opts.maxPoints, sentences.length)).sort(
    (a, b) => a - b,
  );
  const keyPoints = keyIdx.map((i) => point(id, sentences[i]!, scores[i]!));

  // TL;DR: the 3 highest-ranked key points, chronological.
  const tldr = [...keyIdx]
    .sort((a, b) => scores[b]! - scores[a]!)
    .slice(0, 3)
    .sort((a, b) => a - b)
    .map((i) => truncate(sentences[i]!.text, 240))
    .join(" … ");

  // Chapters.
  let chapters: Chapter[];
  let chapterSource: Summary["chapterSource"];
  if (opts.chapters && opts.chapters.length >= 2) {
    chapters = finalizeChapters(id, opts.chapters, duration);
    chapterSource = opts.chapterSource ?? "description";
  } else {
    chapters = deriveChapters(id, sentences, duration);
    chapterSource = "transcript";
  }
  const chapterSummaries: ChapterSummary[] = chapters.map((c, ci) => {
    const isLast = ci === chapters.length - 1;
    const inside = all.filter((i) => sentences[i]!.start >= c.start - 0.5 && (isLast || sentences[i]!.start < c.end - 0.5));
    const pool = inside.filter((i) => sentences[i]!.words >= 6);
    const picked = mmr(pool.length ? pool : inside, scores, vecs, opts.bulletsPerChapter).sort((a, b) => a - b);
    return { ...c, bullets: picked.map((i) => point(id, sentences[i]!, scores[i]!, 240)) };
  });

  // Quotes: high-ranking, self-contained lines of quotable length not already used as key points.
  const used = new Set(keyIdx);
  const quoteIdx = mmr(
    all.filter((i) => !used.has(i) && sentences[i]!.words >= 10 && sentences[i]!.words <= 45),
    scores,
    vecs,
    opts.maxQuotes,
    0.8,
  ).sort((a, b) => a - b);
  const quotes = quoteIdx.map((i) => point(id, sentences[i]!, scores[i]!, 280));

  const words = sentences.reduce((s, x) => s + x.words, 0);
  const minutes = duration / 60;
  return {
    tldr,
    keyPoints,
    keywords: extractKeywords(sentences, opts.keywordLimit),
    chapters: chapterSummaries,
    chapterSource,
    quotes,
    stats: {
      words,
      sentences: sentences.length,
      durationSeconds: round(duration, 1),
      wordsPerMinute: minutes > 0.1 ? Math.round(words / minutes) : null,
      readingTimeMinutes: round(words / 238, 1),
      punctuated: hasPunctuation(segments),
    },
  };
}
