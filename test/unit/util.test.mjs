import assert from "node:assert/strict";
import { test } from "node:test";
import { dist } from "./helpers.mjs";

const { parseVideoId, formatTimestamp, parseTimestamp, normalizeLang, decodeEntities, videoUrl } = await dist("util.js");

test("parseVideoId accepts ids and every common URL shape", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    ` ${id} `,
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}&t=42s`,
    `youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=RD`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}?start=10`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/v/${id}`,
  ]) {
    assert.equal(parseVideoId(input), id, input);
  }
});

test("parseVideoId rejects garbage with INVALID_VIDEO_ID", () => {
  for (const bad of ["", "abc", "https://vimeo.com/123456789", "https://www.youtube.com/watch?v=short", "https://example.com/watch?v=dQw4w9WgXcQ"]) {
    assert.throws(() => parseVideoId(bad), (e) => e.code === "INVALID_VIDEO_ID", bad);
  }
});

test("timestamps format and parse", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(75.9), "1:15");
  assert.equal(formatTimestamp(3725), "1:02:05");
  assert.equal(parseTimestamp("1:15"), 75);
  assert.equal(parseTimestamp("01:02:05"), 3725);
  assert.equal(parseTimestamp("00:00"), 0);
  assert.equal(parseTimestamp("1:2:3:4"), null);
  assert.equal(parseTimestamp("ab:cd"), null);
  assert.equal(videoUrl("dQw4w9WgXcQ", 90.7), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s");
  assert.equal(videoUrl("dQw4w9WgXcQ", 0), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("normalizeLang and decodeEntities", () => {
  assert.equal(normalizeLang("EN_us"), "en-US");
  assert.equal(normalizeLang("zh-Hans"), "zh-Hans");
  assert.equal(decodeEntities("we&#39;re &amp; &quot;ok&quot; &#x2014; &lt;b&gt;"), `we're & "ok" — <b>`);
});
