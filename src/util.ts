/** Small shared helpers: errors, caching, input normalization, time formatting. */

/**
 * Stable, machine-readable error codes returned to MCP clients.
 * They mirror the exception classes of youtube-transcript-api (Python) where one exists.
 */
export const ErrorCodes = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_VIDEO_ID: "INVALID_VIDEO_ID",
  VIDEO_UNAVAILABLE: "VIDEO_UNAVAILABLE",
  VIDEO_PRIVATE: "VIDEO_PRIVATE",
  AGE_RESTRICTED: "AGE_RESTRICTED",
  VIDEO_UNPLAYABLE: "VIDEO_UNPLAYABLE",
  TRANSCRIPTS_DISABLED: "TRANSCRIPTS_DISABLED",
  NO_TRANSCRIPT_FOUND: "NO_TRANSCRIPT_FOUND",
  TRANSLATION_UNAVAILABLE: "TRANSLATION_UNAVAILABLE",
  PO_TOKEN_REQUIRED: "PO_TOKEN_REQUIRED",
  EMPTY_TRANSCRIPT: "EMPTY_TRANSCRIPT",
  NO_CHAPTERS: "NO_CHAPTERS",
  REQUEST_BLOCKED: "REQUEST_BLOCKED",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Codes worth retrying (possibly through a different proxy session). */
const RETRYABLE = new Set<ErrorCode>([ErrorCodes.REQUEST_BLOCKED, ErrorCodes.EMPTY_TRANSCRIPT, ErrorCodes.UPSTREAM_ERROR]);

export class YouTubeError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "YouTubeError";
    this.retryable = RETRYABLE.has(code);
  }
}

export class UserInputError extends YouTubeError {
  constructor(message: string, code: ErrorCode = ErrorCodes.INVALID_INPUT) {
    super(code, message);
    this.name = "UserInputError";
  }
}

/** Tiny TTL + size-bounded cache (insertion-ordered eviction). */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts a bare 11-char video id or any common YouTube URL:
 * watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/, m.youtube.com, music.youtube.com,
 * youtube-nocookie.com.
 */
export function parseVideoId(input: string): string {
  const s = input.trim();
  if (VIDEO_ID_RE.test(s)) return s;
  let url: URL | null = null;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    url = null;
  }
  if (url && /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(url.hostname)) {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (/youtu\.be$/i.test(url.hostname) && parts[0] && VIDEO_ID_RE.test(parts[0])) return parts[0];
    const i = parts.findIndex((p) => ["shorts", "embed", "live", "v", "e"].includes(p));
    if (i >= 0 && parts[i + 1] && VIDEO_ID_RE.test(parts[i + 1]!)) return parts[i + 1]!;
  }
  throw new UserInputError(
    `Invalid video "${input}". Pass an 11-character YouTube video id (e.g. dQw4w9WgXcQ) or a YouTube URL.`,
    ErrorCodes.INVALID_VIDEO_ID,
  );
}

/** Normalize a BCP-47-ish language code: "EN_us" → "en-US". */
export function normalizeLang(code: string): string {
  const [base, ...rest] = code.trim().replace(/_/g, "-").split("-");
  return [base!.toLowerCase(), ...rest.map((r) => (r.length === 2 ? r.toUpperCase() : r))].join("-");
}

/** 75.4 → "1:15", 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1:02:05" / "02:05" / "125" → seconds, or null. */
export function parseTimestamp(ts: string): number | null {
  const parts = ts.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p) && !(parts.length === 1 && /^\d+$/.test(p)))) {
    return null;
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function videoUrl(id: string, atSeconds?: number): string {
  return atSeconds && atSeconds >= 1
    ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(atSeconds)}s`
    : `https://www.youtube.com/watch?v=${id}`;
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Decode the XML/HTML entities that appear in YouTube timedtext and titles. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    if (k === "nbsp") return " ";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}
