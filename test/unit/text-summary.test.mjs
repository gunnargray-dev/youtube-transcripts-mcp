import assert from "node:assert/strict";
import { test } from "node:test";
import { dist, fixture, fixtureJson } from "./helpers.mjs";

const text = await dist("text.js");
const { summarize } = await dist("summary.js");
const { parseDescriptionChapters } = await dist("chapters.js");
const { parseTimedText } = await dist("transcript.js");

const solarSegs = parseTimedText(fixture("timedtext/kM3pLz8QwT0.en.xml"));
const breadSegs = parseTimedText(fixture("timedtext/Vb7nQe2RtY4.en.asr.json"));

test("tokenize / stem / stopwords", () => {
  assert.deepEqual(text.tokenize("It's a Solar-Panel, 22% efficient!"), ["it's", "a", "solar", "panel", "22", "efficient"]);
  assert.equal(text.stem("panels"), "panel");
  assert.equal(text.stem("batteries"), "battery");
  assert.equal(text.stem("charging"), "charg");
  assert.equal(text.stem("stopped"), "stop");
  assert.equal(text.stem("glass"), "glass");
  assert.deepEqual(text.terms("um so the inverters basically convert current"), ["inverter", "convert", "current"]);
});

test("buildSentences splits punctuated captions on sentence boundaries", () => {
  const s = text.buildSentences(solarSegs);
  assert.ok(text.hasPunctuation(solarSegs));
  assert.equal(s[0].text, "Hey everyone, welcome back to Bright Circuits.");
  assert.equal(s[0].start, 0);
  assert.ok(s.every((x) => /[.!?]$/.test(x.text)), "each sentence ends with punctuation");
  assert.ok(s.length >= 40);
});

test("buildSentences chunks unpunctuated ASR text at discourse markers", () => {
  assert.equal(text.hasPunctuation(breadSegs), false);
  const s = text.buildSentences(breadSegs);
  assert.ok(s.every((x) => x.words <= 30));
  assert.ok(!s.some((x) => /\[music\]/i.test(x.text)), "[Music] tags removed");
  assert.ok(s.some((x) => x.text.startsWith("so first things first")));
  assert.ok(s.every((x, i) => i === 0 || x.start >= s[i - 1].start));
});

test("textRank prefers central sentences over greetings", () => {
  const s = text.buildSentences(solarSegs);
  const scores = text.textRank(s);
  assert.equal(scores.length, s.length);
  const best = s[scores.indexOf(Math.max(...scores))];
  assert.match(best.text, /solar|photon|panel|cell|current/i);
  const greeting = scores[0];
  assert.ok(greeting < Math.max(...scores) / 2, "greeting ranks low");
});

test("extractKeywords surfaces the topic vocabulary", () => {
  const kw = text.extractKeywords(text.buildSentences(solarSegs), 10).map((k) => k.term);
  for (const want of ["panels", "inverter", "photons"]) assert.ok(kw.includes(want), `${want} in ${kw}`);
  assert.ok(!kw.some((k) => text.STOPWORDS.has(k)));
  const bread = text.extractKeywords(text.buildSentences(breadSegs), 10).map((k) => k.term);
  for (const want of ["flour", "dough", "starter"]) assert.ok(bread.includes(want), `${want} in ${bread}`);
});

test("summarize: key points, creator-chapter bullets, quotes, stats", () => {
  const desc = fixtureJson("player/kM3pLz8QwT0.json").videoDetails.shortDescription;
  const s = summarize("kM3pLz8QwT0", solarSegs, {
    maxPoints: 6,
    bulletsPerChapter: 2,
    maxQuotes: 3,
    keywordLimit: 10,
    chapters: parseDescriptionChapters(desc, 552),
    chapterSource: "description",
    durationSeconds: 552,
  });
  assert.equal(s.keyPoints.length, 6);
  assert.ok(s.keyPoints.every((p, i) => i === 0 || p.start >= s.keyPoints[i - 1].start), "chronological");
  assert.ok(s.keyPoints.every((p) => p.url.includes("kM3pLz8QwT0") && p.timestamp));
  assert.equal(new Set(s.keyPoints.map((p) => p.text)).size, 6, "no duplicates");
  assert.equal(s.chapterSource, "description");
  assert.equal(s.chapters.length, 7);
  for (const c of s.chapters) {
    assert.ok(c.bullets.length >= 1 && c.bullets.length <= 2, c.title);
    assert.ok(c.bullets.every((b) => b.start >= c.start - 0.5 && b.start < c.end), `bullets inside ${c.title}`);
  }
  assert.match(s.chapters[4].bullets.map((b) => b.text).join(" "), /inverter|current/i);
  assert.equal(s.quotes.length, 3);
  const keyTexts = new Set(s.keyPoints.map((p) => p.text));
  assert.ok(s.quotes.every((q) => !keyTexts.has(q.text)), "quotes differ from key points");
  assert.ok(s.tldr.length > 50);
  assert.equal(s.stats.punctuated, true);
  assert.equal(s.stats.durationSeconds, 552);
});

test("summarize derives chapters when none are given", () => {
  const s = summarize("Vb7nQe2RtY4", breadSegs, {
    maxPoints: 5,
    bulletsPerChapter: 1,
    maxQuotes: 0,
    keywordLimit: 8,
    chapters: null,
    durationSeconds: 750,
  });
  assert.equal(s.chapterSource, "transcript");
  assert.ok(s.chapters.length >= 3);
  assert.ok(s.chapters.every((c) => c.bullets.length === 1));
  assert.equal(s.quotes.length, 0);
  assert.equal(s.keyPoints.length, 5);
  assert.equal(s.stats.punctuated, false);
});
