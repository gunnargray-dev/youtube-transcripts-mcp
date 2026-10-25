import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimedText } from "../../dist/transcript.js";

test("decodes double-escaped caption entities", () => {
  const raw = '<transcript><text start="0" dur="1">it&amp;#39;s R&amp;amp;D &amp;gt; 2</text></transcript>';
  assert.equal(parseTimedText(raw)[0].text, "it's R&D > 2");
});
