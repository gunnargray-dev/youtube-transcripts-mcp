/**
 * Offline fixture mode (`YT_FIXTURES=<dir>`): every YouTube request is answered
 * from recorded files instead of the network. Used by the unit and smoke tests
 * (the build box's IP is blocked by YouTube) and handy for demos.
 *
 * Layout (paths relative to the fixture dir):
 *   watch/<videoId>.html          watch page (falls back to watch/_default.html)
 *   player/<videoId>.json         InnerTube /player response (missing → "Video unavailable")
 *   timedtext/<videoId>.<lang>[.asr][.to-<tlang>].{xml,json}
 *   search/<query-slug>.json      InnerTube /search response (falls back to search/_default.json)
 *   search/continuation-<token>.json
 *
 * Any JSON fixture may instead be an envelope `{"__fixture": {"status": 429, "body": "..."}}`
 * to simulate an HTTP status (e.g. rate limiting).
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HttpRequest, HttpResponse } from "./http.js";

interface Envelope {
  __fixture: { status?: number; body?: unknown };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "_empty"
  );
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function respond(url: string, raw: string | null, fallbackStatus = 404): HttpResponse {
  if (raw === null) return { status: fallbackStatus, text: "", url };
  if (raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<Envelope>;
      if (parsed && typeof parsed === "object" && parsed.__fixture) {
        const { status = 200, body = "" } = parsed.__fixture;
        return { status, text: typeof body === "string" ? body : JSON.stringify(body), url };
      }
    } catch {
      /* not JSON; serve verbatim */
    }
  }
  return { status: 200, text: raw, url };
}

export async function fixtureRequest(dir: string, req: HttpRequest): Promise<HttpResponse> {
  const root = resolve(dir);
  const url = new URL(req.url);
  const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");

  if (url.pathname === "/watch") {
    const v = safe(url.searchParams.get("v") ?? "");
    const raw = (await readOptional(join(root, "watch", `${v}.html`))) ?? (await readOptional(join(root, "watch", "_default.html")));
    return respond(req.url, raw);
  }

  if (url.pathname === "/youtubei/v1/player") {
    const v = safe(String(body.videoId ?? ""));
    const raw = await readOptional(join(root, "player", `${v}.json`));
    if (raw === null) {
      return {
        status: 200,
        url: req.url,
        text: JSON.stringify({
          playabilityStatus: { status: "ERROR", reason: "This video is unavailable" },
        }),
      };
    }
    return respond(req.url, raw);
  }

  if (url.pathname === "/youtubei/v1/search") {
    if (typeof body.continuation === "string") {
      return respond(req.url, await readOptional(join(root, "search", `continuation-${safe(body.continuation)}.json`)));
    }
    const raw =
      (await readOptional(join(root, "search", `${slugify(String(body.query ?? ""))}.json`))) ??
      (await readOptional(join(root, "search", "_default.json")));
    return respond(req.url, raw);
  }

  if (url.pathname === "/api/timedtext") {
    const p = url.searchParams;
    const name = [
      safe(p.get("v") ?? ""),
      safe(p.get("lang") ?? ""),
      ...(p.get("kind") === "asr" ? ["asr"] : []),
      ...(p.get("tlang") ? [`to-${safe(p.get("tlang")!)}`] : []),
    ].join(".");
    for (const ext of ["xml", "json"]) {
      const raw = await readOptional(join(root, "timedtext", `${name}.${ext}`));
      if (raw !== null) return respond(req.url, raw);
    }
    return { status: 404, text: "", url: req.url };
  }

  return { status: 404, text: "", url: req.url };
}
