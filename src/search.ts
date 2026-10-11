/**
 * YouTube search via the InnerTube `/youtubei/v1/search` endpoint (WEB client),
 * with server-side filters encoded as the same protobuf `params` the YouTube
 * web UI uses (the `sp=` URL parameter).
 */
import { withYouTube } from "./http.js";
import { textOf } from "./youtube.js";
import { ErrorCodes, TtlCache, YouTubeError, parseTimestamp, videoUrl } from "./util.js";

const SEARCH_URL = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const WEB_CLIENT_VERSION = "2.20250925.01.00";
const MAX_PAGES = 6;

const cache = new TtlCache<SearchVideo[]>(Number(process.env.CACHE_TTL_MS ?? 10 * 60_000), 200);

export const UPLOAD_DATES = ["hour", "today", "week", "month", "year"] as const;
export const DURATIONS = ["short", "medium", "long"] as const;
export const SORTS = ["relevance", "upload_date", "view_count", "rating"] as const;
export const FEATURES = ["subtitles", "live", "hd", "4k", "creative_commons", "hdr", "360", "vr180", "3d", "location"] as const;

export interface SearchFilters {
  uploadDate?: (typeof UPLOAD_DATES)[number];
  duration?: (typeof DURATIONS)[number];
  sortBy?: (typeof SORTS)[number];
  features?: (typeof FEATURES)[number][];
}

export interface SearchVideo {
  videoId: string;
  url: string;
  title: string;
  channel: string | null;
  channelId: string | null;
  channelUrl: string | null;
  duration: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  viewCountText: string | null;
  published: string | null;
  descriptionSnippet: string | null;
  thumbnail: string | null;
  isLive: boolean;
  badges: string[];
}

// ---------------------------------------------------------------------------
// Filter params (protobuf)
// ---------------------------------------------------------------------------

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
const field = (num: number, value: number) => [...varint(num << 3), ...varint(value)];

const UPLOAD_DATE_VALUE = { hour: 1, today: 2, week: 3, month: 4, year: 5 } as const;
// YouTube's own enum ordering: 1 = under 4 min, 2 = over 20 min, 3 = 4-20 min.
const DURATION_VALUE = { short: 1, long: 2, medium: 3 } as const;
const SORT_VALUE = { relevance: 0, rating: 1, upload_date: 2, view_count: 3 } as const;
const FEATURE_FIELD = {
  hd: 4,
  subtitles: 5,
  creative_commons: 6,
  "3d": 7,
  live: 8,
  "4k": 14,
  "360": 15,
  location: 23,
  hdr: 25,
  vr180: 26,
} as const;

/**
 * Encode filters as base64 protobuf: `SearchParams { 1: sort; 2: Filters { 1: upload_date; 2: type; 3: duration; <feature>: 1 } }`.
 * The result type is always "video" (type = 1), e.g. no filters → "EgIQAQ==".
 */
export function encodeSearchParams(f: SearchFilters = {}): string {
  const filters: number[] = [];
  if (f.uploadDate) filters.push(...field(1, UPLOAD_DATE_VALUE[f.uploadDate]));
  filters.push(...field(2, 1));
  if (f.duration) filters.push(...field(3, DURATION_VALUE[f.duration]));
  for (const feat of [...new Set(f.features ?? [])].sort((a, b) => FEATURE_FIELD[a] - FEATURE_FIELD[b])) {
    filters.push(...field(FEATURE_FIELD[feat], 1));
  }
  const bytes: number[] = [];
  if (f.sortBy && f.sortBy !== "relevance") bytes.push(...field(1, SORT_VALUE[f.sortBy]));
  bytes.push(...varint((2 << 3) | 2), ...varint(filters.length), ...filters);
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Containers whose videos are recommendations, not search results. */
const SKIP_CONTAINERS = new Set(["shelfRenderer", "reelShelfRenderer", "horizontalCardListRenderer", "richShelfRenderer"]);

function collect(node: unknown, key: string, out: unknown[], depth = 0): void {
  if (!node || typeof node !== "object" || depth > 50) return;
  if (Array.isArray(node)) {
    for (const v of node) collect(v, key, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_CONTAINERS.has(k)) continue;
    if (k === key) out.push(v);
    else collect(v, key, out, depth + 1);
  }
}

export function parseViewCount(text: string | null): number | null {
  if (!text) return null;
  if (/^no views/i.test(text.trim())) return 0;
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

interface RawVideoRenderer {
  videoId?: string;
  title?: unknown;
  ownerText?: { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string; canonicalBaseUrl?: string } } }[] };
  longBylineText?: unknown;
  lengthText?: unknown;
  viewCountText?: unknown;
  shortViewCountText?: unknown;
  publishedTimeText?: unknown;
  detailedMetadataSnippets?: { snippetText?: unknown }[];
  descriptionSnippet?: unknown;
  thumbnail?: { thumbnails?: { url?: string; width?: number }[] };
  badges?: { metadataBadgeRenderer?: { label?: string; style?: string } }[];
  thumbnailOverlays?: { thumbnailOverlayTimeStatusRenderer?: { style?: string } }[];
}

export function parseVideoRenderer(v: RawVideoRenderer): SearchVideo | null {
  if (!v?.videoId) return null;
  const owner = v.ownerText?.runs?.[0];
  const browse = owner?.navigationEndpoint?.browseEndpoint;
  const duration = textOf(v.lengthText) || null;
  const viewCountText = textOf(v.viewCountText) || null;
  const badges = (v.badges ?? []).map((b) => b.metadataBadgeRenderer?.label ?? "").filter(Boolean);
  const isLive =
    badges.some((b) => /^live/i.test(b)) ||
    (v.thumbnailOverlays ?? []).some((o) => o.thumbnailOverlayTimeStatusRenderer?.style === "LIVE");
  const thumbs = (v.thumbnail?.thumbnails ?? []).filter((t) => t.url);
  const snippet = textOf(v.detailedMetadataSnippets?.[0]?.snippetText) || textOf(v.descriptionSnippet) || null;
  return {
    videoId: v.videoId,
    url: videoUrl(v.videoId),
    title: textOf(v.title),
    channel: owner?.text ?? (textOf(v.longBylineText) || null),
    channelId: browse?.browseId ?? null,
    channelUrl: browse?.canonicalBaseUrl
      ? `https://www.youtube.com${browse.canonicalBaseUrl}`
      : browse?.browseId
        ? `https://www.youtube.com/channel/${browse.browseId}`
        : null,
    duration,
    durationSeconds: duration ? parseTimestamp(duration) : null,
    viewCount: isLive ? null : parseViewCount(viewCountText),
    viewCountText,
    published: textOf(v.publishedTimeText) || null,
    descriptionSnippet: snippet,
    thumbnail: thumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url?.split("?")[0] ?? null,
    isLive,
    badges,
  };
}

export function parseSearchPage(data: unknown): { videos: SearchVideo[]; continuation: string | null; estimatedResults: number | null } {
  const renderers: unknown[] = [];
  collect(data, "videoRenderer", renderers);
  const tokens: unknown[] = [];
  collect(data, "continuationCommand", tokens);
  const continuation = (tokens as { token?: string }[]).map((t) => t?.token).find((t): t is string => !!t) ?? null;
  const est = (data as { estimatedResults?: string })?.estimatedResults;
  return {
    videos: renderers.map((r) => parseVideoRenderer(r as RawVideoRenderer)).filter((v): v is SearchVideo => !!v),
    continuation,
    estimatedResults: est && /^\d+$/.test(est) ? Number(est) : null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchVideos(
  query: string,
  limit: number,
  filters: SearchFilters,
  opts: { hl?: string; gl?: string } = {},
): Promise<{ videos: SearchVideo[]; params: string; pages: number; estimatedResults: number | null }> {
  const params = encodeSearchParams(filters);
  const hl = opts.hl ?? "en";
  const gl = (opts.gl ?? "US").toUpperCase();
  const key = `${query}|${params}|${hl}|${gl}|${limit}`;
  const hit = cache.get(key);
  if (hit) return { videos: hit, params, pages: 0, estimatedResults: null };

  return withYouTube(async (http) => {
    const context = { client: { clientName: "WEB", clientVersion: WEB_CLIENT_VERSION, hl, gl } };
    const seen = new Set<string>();
    const videos: SearchVideo[] = [];
    let continuation: string | null = null;
    let estimatedResults: number | null = null;
    let pages = 0;
    do {
      const res = await http.request({
        method: "POST",
        url: SEARCH_URL,
        body: JSON.stringify(continuation ? { context, continuation } : { context, query, params }),
      });
      if (res.status >= 400) {
        throw new YouTubeError(ErrorCodes.UPSTREAM_ERROR, `YouTube search responded ${res.status}`, { httpStatus: res.status });
      }
      let data: unknown;
      try {
        data = JSON.parse(res.text);
      } catch {
        throw new YouTubeError(ErrorCodes.UPSTREAM_ERROR, "YouTube search returned a non-JSON response");
      }
      const page = parseSearchPage(data);
      pages++;
      estimatedResults ??= page.estimatedResults;
      for (const v of page.videos) {
        if (seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        videos.push(v);
      }
      continuation = page.videos.length ? page.continuation : null;
    } while (videos.length < limit && continuation && pages < MAX_PAGES);

    const out = videos.slice(0, limit);
    cache.set(key, out);
    return { videos: out, params, pages, estimatedResults };
  });
}
