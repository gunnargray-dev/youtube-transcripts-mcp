import assert from "node:assert/strict";
import { test } from "node:test";
import { dist, fixture } from "./helpers.mjs";

const { parseTimedText, toPlainText, toSrt, segmentsEnd } = await dist("transcript.js");

test("parses srv1 XML (manual captions) with entities", () => {
  const segs = parseTimedText(fixture("timedtext/kM3pLz8QwT0.en.xml"));
  assert.ok(segs.length > 100);
  assert.deepEqual(segs[0], { text: "Hey everyone, welcome back to Bright Circuits.", start: 0, duration: 4.116 });
  assert.ok(segs.some((s) => s.text.includes("we're")), "&#39; decoded");
  assert.ok(segs.every((s, i) => i === 0 || s.start >= segs[i - 1].start), "sorted");
});

test("parses json3 (ASR) and skips append/newline events", () => {
  const segs = parseTimedText(fixture("timedtext/Vb7nQe2RtY4.en.asr.json"));
  assert.ok(segs.length > 80);
  assert.ok(segs.every((s) => s.text && s.text !== "\n"));
  assert.equal(segs[0].text, "[Music] hey guys welcome to the kitchen today");
  assert.ok(segs[1].start > segs[0].start);
});

test("parses srv3 and strips inline tags", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>
    <p t="1200" d="2500"><s>Hello</s><s t="400"> world</s></p>
    <p t="3800" d="1000"><i>it&#39;s</i> me</p><p t="5000" d="10"> </p></body></timedtext>`;
  assert.deepEqual(parseTimedText(xml), [
    { text: "Hello world", start: 1.2, duration: 2.5 },
    { text: "it's me", start: 3.8, duration: 1 },
  ]);
});

test("empty/garbage input yields no segments", () => {
  assert.deepEqual(parseTimedText("<transcript></transcript>"), []);
  assert.deepEqual(parseTimedText('{"events":[]}'), []);
});

test("formats text, timestamped text and SRT", () => {
  const segs = [
    { text: "one", start: 0, duration: 5 },
    { text: "two", start: 4, duration: 5 }, // overlaps previous
    { text: "three", start: 35, duration: 2.5 },
  ];
  assert.equal(toPlainText(segs, false), "one two three");
  assert.equal(toPlainText(segs, true), "[0:00] one two\n[0:35] three");
  const srt = toSrt(segs);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,000\none\n/);
  assert.match(srt, /3\n00:00:35,000 --> 00:00:37,500\nthree\n$/);
  assert.equal(segmentsEnd(segs), 37.5);
});
