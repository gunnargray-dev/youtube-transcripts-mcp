import assert from "node:assert/strict";
import { test } from "node:test";
import { dist, fixture, fixtureJson } from "./helpers.mjs";

const { parseDescriptionChapters, finalizeChapters, deriveChapters } = await dist("chapters.js");
const { parseTimedText } = await dist("transcript.js");
const { buildSentences } = await dist("text.js");

test("parses the chapter list from a real-style description", () => {
  const desc = fixtureJson("player/kM3pLz8QwT0.json").videoDetails.shortDescription;
  const ch = parseDescriptionChapters(desc, 552);
  assert.deepEqual(
    ch.map((c) => [c.start, c.title]),
    [
      [0, "Intro"],
      [42, "What sunlight is made of"],
      [118, "Inside a silicon solar cell"],
      [220, "From cells to panels"],
      [305, "Inverters and the grid"],
      [408, "Batteries and storage"],
      [490, "Is solar worth it?"],
    ],
  );
});

test("handles title-first, bracketed, numbered and range formats", () => {
  const desc = [
    "Intro - 0:00",
    "(1:23) Q&A (live)",
    "3. 02:10 – Setup",
    "[03:30] Wiring | part 1",
    "4:00 - 5:30 Testing",
    "1:01:05 Outro",
  ].join("\n");
  assert.deepEqual(
    parseDescriptionChapters(desc).map((c) => [c.start, c.title]),
    [
      [0, "Intro"],
      [83, "Q&A (live)"],
      [130, "Setup"],
      [210, "Wiring | part 1"],
      [240, "Testing"],
      [3665, "Outro"],
    ],
  );
});

test("rejects descriptions without a usable chapter list", () => {
  assert.deepEqual(parseDescriptionChapters("No timestamps here.\nJust text."), []);
  assert.deepEqual(parseDescriptionChapters("Skip to 4:20 for the good part"), [], "single timestamp");
  assert.deepEqual(parseDescriptionChapters("5:00 A\n6:00 B\n7:00 C"), [], "must start near 0:00");
  assert.deepEqual(parseDescriptionChapters("0:00 A\n1:00 B\n9:00 C", 300).length, 2, "drops timestamps past the end");
  // A second, unrelated timestamp list (e.g. song credits) does not extend the chapters.
  const two = parseDescriptionChapters("0:00 Intro\n2:00 Main\nSongs:\n0:00 Song A\n1:30 Song B");
  assert.deepEqual(two.map((c) => c.title), ["Intro", "Main"]);
});

test("finalizeChapters computes end, duration, deep links", () => {
  const ch = finalizeChapters("kM3pLz8QwT0", [{ title: "A", start: 0 }, { title: "B", start: 90 }], 200);
  assert.deepEqual(ch[1], {
    index: 2,
    title: "B",
    start: 90,
    end: 200,
    duration: 110,
    startTime: "1:30",
    url: "https://www.youtube.com/watch?v=kM3pLz8QwT0&t=90s",
  });
  assert.equal(ch[0].end, 90);
});

test("deriveChapters finds topic shifts in an unpunctuated ASR transcript", () => {
  const segs = parseTimedText(fixture("timedtext/Vb7nQe2RtY4.en.asr.json"));
  const sentences = buildSentences(segs);
  const ch = deriveChapters("Vb7nQe2RtY4", sentences, 750);
  assert.ok(ch.length >= 4 && ch.length <= 8, `got ${ch.length} chapters`);
  assert.equal(ch[0].start, 0);
  for (let i = 1; i < ch.length; i++) {
    assert.ok(ch[i].start > ch[i - 1].start, "ascending");
    assert.equal(ch[i - 1].end, ch[i].start, "contiguous");
  }
  assert.ok(ch.every((c) => c.title && c.keywords.length && c.summary));
  // True topic boundaries of the hand-written fixture: mixing, bulk, shaping, baking, cooling.
  const truth = [150, 270, 400, 540, 670];
  const hits = truth.filter((t) => ch.some((c) => Math.abs(c.start - t) <= 60));
  assert.ok(hits.length >= 4, `only matched ${hits} with ${ch.map((c) => c.start)}`);
  assert.ok(ch.some((c) => /stretch|folds|bulk/i.test(c.title)), "bulk fermentation chapter titled by its keywords");
});

test("deriveChapters honours target_chapters and handles tiny transcripts", () => {
  const segs = parseTimedText(fixture("timedtext/kM3pLz8QwT0.en.xml"));
  const ch = deriveChapters("kM3pLz8QwT0", buildSentences(segs), 552, { targetChapters: 3 });
  assert.ok(ch.length >= 2 && ch.length <= 4, `got ${ch.length}`);
  const tiny = deriveChapters("x", buildSentences([{ text: "Just one short sentence here.", start: 0, duration: 3 }]), 3);
  assert.equal(tiny.length, 1);
  assert.deepEqual(deriveChapters("x", [], 0), []);
});
