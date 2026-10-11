import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURES, dist, fixtureJson } from "./helpers.mjs";

process.env.YT_FIXTURES = FIXTURES;
const s = await dist("search.js");

test("encodeSearchParams matches YouTube's own sp= values", () => {
  assert.equal(s.encodeSearchParams({}), "EgIQAQ=="); // type: video
  assert.equal(s.encodeSearchParams({ uploadDate: "today" }), "EgQIAhAB");
  assert.equal(s.encodeSearchParams({ sortBy: "upload_date" }), "CAISAhAB");
  assert.equal(s.encodeSearchParams({ features: ["subtitles"] }), "EgQQASgB");
  assert.equal(s.encodeSearchParams({ duration: "long" }), "EgQQARgC");
  // Multi-byte field tags (location = field 23 → varint 0xB8 0x01).
  const bytes = [...Buffer.from(s.encodeSearchParams({ features: ["location", "hd"] }), "base64")];
  assert.deepEqual(bytes, [0x12, 0x07, 0x10, 0x01, 0x20, 0x01, 0xb8, 0x01, 0x01]);
  assert.equal(s.encodeSearchParams({ sortBy: "relevance" }), "EgIQAQ==", "relevance is the default");
});

test("parseSearchPage extracts videos, skips shelves, finds continuation", () => {
  const page = s.parseSearchPage(fixtureJson("search/solar-panels.json"));
  assert.equal(page.videos.length, 6);
  assert.ok(!page.videos.some((v) => v.videoId === "Shelf0Vid01"), "shelf recommendation skipped");
  assert.equal(page.continuation, "CONT_solar_p2");
  assert.equal(page.estimatedResults, 48200000);
  const [first] = page.videos;
  assert.equal(first.videoId, "kM3pLz8QwT0");
  assert.equal(first.channel, "Bright Circuits");
  assert.equal(first.channelUrl, "https://www.youtube.com/@brightcircuits");
  assert.equal(first.durationSeconds, 552);
  assert.equal(first.viewCount, 1843291);
  assert.equal(first.thumbnail, "https://i.ytimg.com/vi/kM3pLz8QwT0/hq720.jpg");
  assert.match(first.descriptionSnippet, /solar energy/);
  const live = page.videos.find((v) => v.videoId === "LiveSol4r01");
  assert.equal(live.isLive, true);
  assert.equal(live.viewCount, null);
  assert.equal(live.durationSeconds, null);
});

test("parseViewCount handles full, abbreviated and empty counts", () => {
  assert.equal(s.parseViewCount("1,843,291 views"), 1843291);
  assert.equal(s.parseViewCount("612K views"), 612000);
  assert.equal(s.parseViewCount("2.3M views"), 2300000);
  assert.equal(s.parseViewCount("No views"), 0);
  assert.equal(s.parseViewCount(null), null);
});

test("searchVideos paginates via continuation and respects limit", async () => {
  const one = await s.searchVideos("solar panels", 3, {});
  assert.equal(one.videos.length, 3);
  assert.equal(one.pages, 1);
  const many = await s.searchVideos("solar panels", 20, { duration: "medium" });
  assert.equal(many.videos.length, 9);
  assert.equal(many.pages, 2);
  assert.equal(new Set(many.videos.map((v) => v.videoId)).size, 9);
  const none = await s.searchVideos("qwertyuiop nothing", 10, {});
  assert.equal(none.videos.length, 0);
});
