/**
 * Dependency-free text analytics for transcripts: tokenization, light stemming,
 * sentence building from caption segments, TF-IDF vectors, cosine similarity,
 * TextRank and keyword extraction. No LLM, fully deterministic.
 */
import type { Segment } from "./transcript.js";

// English stopwords plus spoken-language fillers that carry no topic signal.
export const STOPWORDS = new Set(
  `a about above after again against all almost also am an and any are aren't as at be because been before being
  below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
  even ever every few for from further get gets getting got had hadn't has hasn't have haven't having he he'd he'll
  he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its
  itself just let's like me more most much must mustn't my myself no nor not now of off on once only or other ought
  our ours ourselves out over own really same shan't she she'd she'll she's should shouldn't so some still such than
  that that's the their theirs them themselves then there there's these they they'd they'll they're they've this
  those though through to too under until up upon us very was wasn't we we'd we'll we're we've were weren't what
  what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd
  you'll you're you've your yours yourself yourselves
  im ive dont doesnt didnt cant wont isnt its thats youre theyre weve youve ill id
  um uh uhm hmm mm yeah yep yes oh okay ok alright right well actually basically literally gonna wanna gotta kinda
  sorta lot lots thing things stuff something anything everything nothing someone anyone everyone way ways kind sort
  going go goes went gone come comes came know knows knew think thinks thought mean means say says said see sees
  saw look looks looking want wants make makes made take takes took put puts let lets need needs use used using
  one two three first next last also maybe probably pretty quite little bit just really very much many good great
  new time times today now then back around still even already always never sure guys hey hi hello welcome video
  videos channel subscribe music applause laughter inaudible another us able though whether
  four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty sixty seventy eighty ninety
  hundred thousand million billion half`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(" ")
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export const isContentWord = (t: string) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t);

/** Very light English stemmer: enough to merge "panels"/"panel", "charging"/"charge". */
export function stem(w: string): string {
  if (w.length <= 4 || !/^[a-z']+$/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 6) {
    const b = w.slice(0, -3);
    return /([^aeiou])\1$/.test(b) && !/(ll|ss|zz)$/.test(b) ? b.slice(0, -1) : b;
  }
  if (w.endsWith("ed") && w.length > 5 && !w.endsWith("eed")) {
    const b = w.slice(0, -2);
    return /([^aeiou])\1$/.test(b) && !/(ll|ss|zz)$/.test(b) ? b.slice(0, -1) : b;
  }
  if (w.endsWith("es") && /(ch|sh|x|ss|zz)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

/** Content-word stems of a text. */
export function terms(text: string): string[] {
  return tokenize(text).filter(isContentWord).map(stem);
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  words: number;
}

// Caption annotations such as [Music], [Applause], ♪, ">>" speaker-change marks.
const NOISE = /\[[^\]]{0,30}\]|♪+|>>/g;
/** Words that typically open a new spoken sentence; used to split unpunctuated auto-captions. */
const DISCOURSE_WORDS = new Set(["so", "now", "okay", "ok", "alright", "next", "finally", "first", "second", "third", "then", "after", "once"]);

/** Proportion-based check: do the captions carry sentence punctuation? (manual captions do; ASR mostly doesn't). */
export function hasPunctuation(segments: Segment[]): boolean {
  const text = segments.map((s) => s.text).join(" ");
  const words = text.split(/\s+/).length;
  const stops = (text.match(/[.!?。！？](?=\s|$)/g) ?? []).length;
  return words > 0 && stops / words >= 1 / 40;
}

/**
 * Turn caption segments into sentences with start/end times.
 * Punctuated captions are split on sentence punctuation; unpunctuated
 * auto-captions are re-timed per word and grouped into 10-30 word chunks,
 * breaking before discourse markers ("so", "now", "next", ...) or long pauses.
 */
export function buildSentences(segments: Segment[]): Sentence[] {
  const segs = segments
    .map((s) => ({ ...s, text: s.text.replace(NOISE, " ").replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text);
  const out: Omit<Sentence, "index">[] = [];
  const push = (parts: string[], start: number, end: number) => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({ text, start, end, words: text.split(" ").length });
  };

  if (hasPunctuation(segs)) {
    let buf: string[] = [];
    let start = segs[0]?.start ?? 0;
    for (const s of segs) {
      const pieces = s.text.split(/(?<=[.!?。！？]["')\]]?)\s+/);
      pieces.forEach((piece, i) => {
        if (!buf.length) start = s.start;
        buf.push(piece);
        const closes = /[.!?。！？]["')\]]?$/.test(piece);
        const last = i === pieces.length - 1;
        if (closes || (!last && pieces.length > 1)) {
          push(buf, start, s.start + s.duration);
          buf = [];
        }
      });
      // Runaway sentence guard (missing punctuation in a long stretch).
      if (buf.join(" ").split(" ").length > 60) {
        push(buf, start, s.start + s.duration);
        buf = [];
      }
    }
    if (buf.length) push(buf, start, segs[segs.length - 1]!.start + segs[segs.length - 1]!.duration);
  } else {
    // Word-level timing: spread each cue's words evenly over its duration
    // (ASR cues overlap, so a cue ends no later than the next one starts).
    const words: { w: string; t: number; end: number }[] = [];
    segs.forEach((s, i) => {
      const next = segs[i + 1];
      const end = next ? Math.min(next.start, s.start + s.duration) : s.start + s.duration;
      const ws = s.text.split(" ");
      const step = Math.max(0, end - s.start) / ws.length;
      ws.forEach((w, j) => words.push({ w, t: s.start + j * step, end: s.start + (j + 1) * step }));
    });
    let buf: typeof words = [];
    const flush = () => {
      if (buf.length) push(buf.map((x) => x.w), buf[0]!.t, buf[buf.length - 1]!.end);
      buf = [];
    };
    words.forEach((x, i) => {
      const prev = words[i - 1];
      const pause = prev ? x.t - prev.end > 1.5 : false;
      const marker = DISCOURSE_WORDS.has(x.w.toLowerCase()) || (x.w.toLowerCase() === "let's" && buf.length >= 10);
      if (buf.length >= 30 || (buf.length >= 10 && (marker || pause))) flush();
      buf.push(x);
    });
    flush();
  }
  return out.map((s, index) => ({ ...s, index }));
}

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export type Vec = Map<string, number>;

export function countTerms(text: string): Vec {
  const v: Vec = new Map();
  for (const t of terms(text)) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

export function idf(docs: Vec[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const out = new Map<string, number>();
  for (const [t, c] of df) out.set(t, Math.log((1 + n) / (1 + c)) + 1);
  return out;
}

export function tfidf(doc: Vec, weights: Map<string, number>): Vec {
  const v: Vec = new Map();
  for (const [t, c] of doc) v.set(t, (1 + Math.log(c)) * (weights.get(t) ?? 1));
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, x] of small) {
    const y = large.get(t);
    if (y) dot += x * y;
  }
  if (!dot) return 0;
  let na = 0;
  let nb = 0;
  for (const x of a.values()) na += x * x;
  for (const x of b.values()) nb += x * x;
  return dot / Math.sqrt(na * nb);
}

export function addVec(into: Vec, v: Vec): Vec {
  for (const [t, c] of v) into.set(t, (into.get(t) ?? 0) + c);
  return into;
}

// ---------------------------------------------------------------------------
// TextRank
// ---------------------------------------------------------------------------

/**
 * TextRank over sentences: PageRank on a graph whose edge weights are TF-IDF
 * cosine similarities. Returns one score per sentence (sums to ~1).
 * Very short fragments are down-weighted so they don't win on lexical overlap alone.
 */
export function textRank(sentences: Sentence[], opts: { damping?: number; iterations?: number } = {}): number[] {
  const n = sentences.length;
  if (!n) return [];
  if (n === 1) return [1];
  const d = opts.damping ?? 0.85;
  const counts = sentences.map((s) => countTerms(s.text));
  const w = idf(counts);
  const vecs = counts.map((c) => tfidf(c, w));
  // Similarity matrix (sparse rows).
  const rows: { j: number; w: number }[][] = Array.from({ length: n }, () => []);
  const rowSum = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(vecs[i]!, vecs[j]!);
      if (sim <= 0.05) continue;
      rows[i]!.push({ j, w: sim });
      rows[j]!.push({ j: i, w: sim });
      rowSum[i]! += sim;
      rowSum[j]! += sim;
    }
  }
  let score = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < (opts.iterations ?? 40); it++) {
    const next = new Array<number>(n).fill((1 - d) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!rowSum[i]) {
        dangling += score[i]!;
        continue;
      }
      for (const { j, w: wt } of rows[i]!) next[j]! += (d * score[i]! * wt) / rowSum[i]!;
    }
    for (let i = 0; i < n; i++) next[i]! += (d * dangling) / n;
    const delta = next.reduce((s, x, i) => s + Math.abs(x - score[i]!), 0);
    score = next;
    if (delta < 1e-7) break;
  }
  return score.map((s, i) => {
    const words = sentences[i]!.words;
    const lengthFactor = words < 6 ? 0.3 : words < 10 ? 0.7 : words > 60 ? 0.8 : 1;
    return s * lengthFactor;
  });
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export interface Keyword {
  term: string;
  /** Occurrences in the transcript. */
  count: number;
  score: number;
  /** First time (seconds) the keyword is mentioned. */
  firstMention: number | null;
}

/**
 * Keywords/keyphrases: content-word unigrams and bigrams scored by frequency
 * weighted with an IDF over time windows (`docs`), so topic words that recur
 * across the whole video and distinctive terms both surface. Unigrams largely
 * explained by a selected bigram are dropped. Display form = most frequent surface form.
 */
export function extractKeywords(sentences: Sentence[], limit: number, extraStop: Iterable<string> = []): Keyword[] {
  const stop = new Set([...extraStop].map((s) => stem(s.toLowerCase())));
  const stats = new Map<string, { count: number; surfaces: Map<string, number>; first: number; windows: Set<number>; n: number }>();
  const windowOf = (t: number) => Math.floor(t / 60);
  const allWindows = new Set<number>();
  for (const s of sentences) {
    const win = windowOf(s.start);
    allWindows.add(win);
    const toks = tokenize(s.text);
    for (let n = 1; n <= 2; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const gram = toks.slice(i, i + n);
        if (!gram.every(isContentWord)) continue;
        const stems = gram.map(stem);
        if (stems.some((x) => stop.has(x))) continue;
        if (n === 2 && stems[0] === stems[1]) continue;
        const key = stems.join(" ");
        let st = stats.get(key);
        if (!st) stats.set(key, (st = { count: 0, surfaces: new Map(), first: s.start, windows: new Set(), n }));
        st.count++;
        st.windows.add(win);
        const surface = gram.join(" ");
        st.surfaces.set(surface, (st.surfaces.get(surface) ?? 0) + 1);
      }
    }
  }
  const nWin = Math.max(1, allWindows.size);
  const scored = [...stats.entries()]
    .filter(([, s]) => s.count >= 2 || sentences.length < 15)
    .map(([key, s]) => {
      const spread = s.windows.size / nWin; // 0..1
      const idfW = Math.log(1 + nWin / s.windows.size);
      const score = s.count * (s.n === 2 ? 1.6 : 1) * (0.6 * idfW + 0.4 * (1 + spread));
      return { key, s, score };
    })
    .sort((a, b) => b.score - a.score || b.s.count - a.s.count);

  const selected: typeof scored = [];
  for (const cand of scored) {
    if (selected.length >= limit) break;
    if (cand.s.n === 1) {
      const covered = selected.some(
        (b) => b.s.n === 2 && b.key.split(" ").includes(cand.key) && b.s.count >= 0.6 * cand.s.count,
      );
      if (covered) continue;
    } else {
      // A bigram whose both words are already selected adds little unless it's frequent.
      const parts = cand.key.split(" ");
      if (parts.every((p) => selected.some((x) => x.key === p)) && cand.s.count < 3) continue;
    }
    selected.push(cand);
  }
  return selected.map(({ s, score }) => ({
    term: [...s.surfaces.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    count: s.count,
    score: Math.round(score * 100) / 100,
    firstMention: Math.round(s.first),
  }));
}

/** Terms that are frequent in `local` but rare elsewhere (`others`): used for chapter titles. */
export function distinctiveTerms(local: Vec, others: Vec[], limit: number): string[] {
  const n = others.length + 1;
  const df = new Map<string, number>();
  for (const d of [local, ...others]) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return [...local.entries()]
    .filter(([, c]) => c >= 2 || local.size < 12)
    .map(([t, c]) => ({ t, s: c * Math.log(1 + n / df.get(t)!) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Map stems back to their most common surface form within `text`. */
export function surfaceForms(text: string): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const tok of tokenize(text)) {
    if (!isContentWord(tok)) continue;
    const st = stem(tok);
    const m = counts.get(st) ?? new Map<string, number>();
    m.set(tok, (m.get(tok) ?? 0) + 1);
    counts.set(st, m);
  }
  const out = new Map<string, string>();
  for (const [st, m] of counts) out.set(st, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0]);
  return out;
}
