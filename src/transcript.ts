/** Timedtext parsing (srv1 XML, srv3 XML, json3) and output formatting (text, segments, SRT). */
import { decodeEntities, formatTimestamp, round } from "./util.js";

export interface Segment {
  text: string;
  /** Start time in seconds. */
  start: number;
  /** Duration in seconds. */
  duration: number;
}

// YouTube often double-escapes caption text ("&amp;#39;"), so decode twice.
const clean = (s: string) =>
  decodeEntities(decodeEntities(s.replace(/<[^>]*>/g, "")))
    .replace(/[​﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function attr(attrs: string, name: string): string | null {
  return attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

/**
 * Parse any of YouTube's caption formats into ordered, non-empty segments.
 *  - srv1:  <transcript><text start="1.2" dur="3.4">…</text></transcript>
 *  - srv3:  <timedtext format="3"><body><p t="1200" d="3400"><s>…</s></p></body></timedtext>
 *  - json3: {"events":[{"tStartMs":1200,"dDurationMs":3400,"segs":[{"utf8":"…"}]}]}
 */
export function parseTimedText(raw: string): Segment[] {
  const body = raw.trim();
  const out: Segment[] = [];
  if (body.startsWith("{")) {
    const data = JSON.parse(body) as {
      events?: { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: { utf8?: string }[] }[];
    };
    for (const e of data.events ?? []) {
      if (!e.segs || e.aAppend) continue;
      const text = clean(e.segs.map((s) => s.utf8 ?? "").join(""));
      if (text) out.push({ text, start: (e.tStartMs ?? 0) / 1000, duration: (e.dDurationMs ?? 0) / 1000 });
    }
  } else if (/<timedtext[^>]*format="3"/.test(body) || /<p\s[^>]*\bt="\d+"/.test(body)) {
    for (const m of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const text = clean(m[2]!);
      const t = Number(attr(m[1]!, "t") ?? 0);
      const d = Number(attr(m[1]!, "d") ?? 0);
      if (text) out.push({ text, start: t / 1000, duration: d / 1000 });
    }
  } else {
    for (const m of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
      const text = clean(m[2]!);
      const start = Number(attr(m[1]!, "start") ?? 0);
      const dur = Number(attr(m[1]!, "dur") ?? 0);
      if (text) out.push({ text, start, duration: dur });
    }
  }
  return out
    .filter((s) => Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ text: s.text, start: round(s.start, 3), duration: round(Math.max(0, s.duration), 3) }));
}

export function segmentsEnd(segments: Segment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.start + last.duration : 0;
}

/** Plain text. With timestamps, segments are grouped into ~`paragraphSeconds` lines prefixed with [m:ss]. */
export function toPlainText(segments: Segment[], includeTimestamps: boolean, paragraphSeconds = 30): string {
  if (!includeTimestamps) return segments.map((s) => s.text).join(" ");
  const lines: string[] = [];
  let cur: string[] = [];
  let curStart = segments[0]?.start ?? 0;
  for (const s of segments) {
    if (cur.length && s.start - curStart >= paragraphSeconds) {
      lines.push(`[${formatTimestamp(curStart)}] ${cur.join(" ")}`);
      cur = [];
      curStart = s.start;
    }
    cur.push(s.text);
  }
  if (cur.length) lines.push(`[${formatTimestamp(curStart)}] ${cur.join(" ")}`);
  return lines.join("\n");
}

function srvTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** SubRip. A cue ends when the next one starts if the caption durations overlap (auto captions do). */
export function toSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => {
      const next = segments[i + 1];
      const end = next && next.start < s.start + s.duration ? next.start : s.start + s.duration;
      return `${i + 1}\n${srvTime(s.start)} --> ${srvTime(end)}\n${s.text}\n`;
    })
    .join("\n");
}
