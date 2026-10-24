# Example workflows

Four ways people use the YouTube Transcripts MCP server with an agent. Each one lists the prompt to give your agent, the tool calls it makes, what it costs on the [hosted server](https://apify.com/parallelstudio/youtube-transcripts-mcp), and a real (trimmed) result. The results come from live calls made on October 24, 2026, against public YouTube videos; full responses are in [`demo/workflows-live.json`](../demo/workflows-live.json).

Set up your client first: see [Connect your MCP client](../README.md#connect-your-mcp-client).

Two things to know about the output you'll see below:

- Apostrophes and ampersands in caption text come back HTML-escaped (`&#39;`, `&amp;`) exactly as YouTube serves them. The quotes below are shown with those decoded.
- Prices are the per-call prices from the [Pricing](../README.md#pricing) table, plus Apify's tiny per-start charge. Failed calls are not charged as tool events.

---

## 1. Research a long talk and answer with timestamp citations

**When:** you have a 2-hour stream, podcast or conference talk and one specific question, and you don't want to scrub through it.

**Prompt**

> Load the transcript of https://www.youtube.com/watch?v=ThjvMReOXYM. Does he say futures need to be pinned, and what happens if you box them? Answer from the transcript and cite timestamps.

**Calls:** one `get_transcript` with `{ "video": "ThjvMReOXYM", "format": "text", "include_timestamps": true }`.
**Cost:** $0.005.

**Result (trimmed):** "Crust of Rust: async/await" by Jon Gjengset, 2:34:01. English, manual captions (not auto-generated), 3,088 segments, 21,823 words, `truncated: false`. The text comes back as roughly 30-second paragraphs, each starting with `[h:mm:ss]`:

```
[1:52:22] ... Of course, the way that you can solve this problem is by boxing your futures. So if you place them on the heap, this problem sort of goes away. ... In practice, we need to use box pin for reasons we're not going to get into. ...
[1:52:52] ... pass x to bar, I'm just passing a pointer to a heap allocation that bar can then treat as a future rather than the entirety of the state machine that I constructed. ...
[1:54:00] ... Why can futures assigned on the stack be moved? Don't they need to be pinned? We're not going to talk too much about pin, but basically there's nothing that prevents you from moving a future. ... But once you have started awaiting a future, you can't move it again unless it's on pin.
```

An answer the agent can write from this: boxing puts the future on the heap, so you pass a pointer instead of the whole state machine (1:52:22–1:52:52); nothing stops you from moving a future until you start awaiting it, after which it must stay pinned (1:54:00).

**Watch the size:** this transcript is about 122,000 characters, which is a lot of context. If you only need the start of a video, pass `max_chars`. For a long video, `summarize_transcript` or `get_video_chapters` (workflows 2 and 3) is the cheaper way to find the right section, and you can then ask for the full text only when you need quotes.

---

## 2. Search a topic and summarize the top results

**When:** you want a quick read on what's out there about a topic, without watching anything.

**Prompt**

> Find videos from the last year about async/await in Rust, 4–20 minutes long and with subtitles. Summarize the top 3 and tell me what each one covers, with links to the moments.

**Calls:** `search_videos` with `{ "query": "async await in Rust", "limit": 5, "upload_date": "year", "duration": "medium", "features": ["subtitles"] }`, then `summarize_transcript` for each of the first three ids with `{ "video": "<id>", "max_points": 4, "max_quotes": 1 }`.
**Cost:** $0.003 + 3 × $0.015 = $0.048.

**Result (trimmed):** the search returned 5 videos (YouTube estimated 18 matches). The first three:

| Video | Channel | Length | Key points (extractive, with link times) |
|---|---|---|---|
| Learn Rust: Async and Await Fundamentals (`m0LUFjB8W4c`) | Will Velida | 11:16 | [1:21] "Await tells the runtime to run the future." · [9:46] "It drives the future to its value, and while that future awaits, the thread gets on with other work." |
| Debugging Async Rust Like a Pro (`rztQ_-Qg1ys`) | Stable Rust | 5:33 | [2:06] the logs inside the function don't show "because we have forgotten to await our function" · [2:27] "So by adding logs, we can easily debug our async function." |
| Rust Async Closures: 3 Checks of Borrowing Limits (`YeAsLFiDSoo`) | Call Stack | 7:38 | [3:02] calling `push` creates a future, and awaiting it is a second operation · [5:37] "Dropping the first pending future before the next call compiles." |

Each summary also returned a TL;DR, keywords (for the third video: future, closure, borrow, compiler, vector), per-chapter bullets and a quote, and every point carries a link like `https://www.youtube.com/watch?v=rztQ_-Qg1ys&t=126s`.

**How to read it:** the summary is extractive. It selects sentences from the transcript and does not rewrite them, so it keeps the speaker's wording, including rough spots. In the first video, for example, one key point is "OK, so I've created a new project called Async programming…", which is a setup line, not a takeaway. Use the links to check a point in context, and have the agent pull `get_transcript` for any video that matters. The video's view counts here are small (17 to 7,580); `search_videos` returns `viewCount` so the agent can weigh that.

---

## 3. Chapters for a long video that has none

**When:** an hour-long interview or lecture with no chapter markers, and you want to know where each topic starts.

**Prompt**

> Give me a table of contents for https://www.youtube.com/watch?v=LjEdBFDHKno with start times and links.

**Calls:** one `get_video_chapters` with `{ "video": "LjEdBFDHKno" }` (`source` defaults to `auto`: creator chapters if there are any, otherwise derived from the transcript).
**Cost:** $0.008.

**Result (trimmed):** "Music Is My Life: Jazz Vibraphone Legend Gary Burton", Berklee Online, 1:10:59. The response says `"source": "transcript"` and `"note": "No creator chapters found; chapters were derived from topic shifts in the transcript."` It returned 9 chapters:

| # | Start | Title (distinctive keywords) | Representative sentence |
|---|---|---|---|
| 1 | 0:00 | Berklee, lessons, instrument | "…that's how I got introduced to the mallet instruments and started playing them." |
| 2 | 6:58 | Play, high, sister | "These were things that we could play in the high school band…" |
| 3 | 11:00 | Record, nashville, summer | "So he proposed that I come to Nashville for the summer…" |
| 4 | 18:57 | Year, school, start | "And if I don't find any work, I'll come back to Berklee for another year." |
| 5 | 30:56 | Stan, girl, playing | "Now that was my-- during my three years with Stan Getz." |
| 6 | 35:57 | Rock, drink, stan | "…the problem for jazz people was that a lot of jazz fans were being drawn over to the rock side…" |
| 7 | 43:09 | Miles, leonard, stage | "No, I never played with Miles." |
| 8 | 48:00 | Playing, years, chick | "We've been playing together for over 30 years, off and on." |
| 9 | 58:58 | Play, change, without | "And, of course, I've played a lot with some of the same musicians over the years." |

Each chapter also has `end`, `duration` and a deep link.

**How to read it:** derived titles are keywords, not headings, so they're good for navigation ("Nashville is around 11:00") and less good as display text. Ask the agent to write a human title for each row from the representative sentence. Pass `target_chapters` to get more or fewer sections. Pass `source: "description"` if you only want creator chapters; that call fails with `NO_CHAPTERS` (not charged) when there are none. We saw exactly that on this video and on `GTJV_zb3-JY` while looking for a test case.

---

## 4. Export subtitles as SRT, in another language

**When:** you want a `.srt` file for a video, in a language other than the one it's spoken in, to hand to an editor or a player.

**Prompt**

> Get German subtitles for https://www.youtube.com/watch?v=aircAruvnKk as an SRT file. Save it as neural-network.de.srt.

**Calls:** one `get_transcript` with `{ "video": "aircAruvnKk", "format": "srt", "translate_to": "de" }`.
**Cost:** $0.005.

**Result (trimmed):** "But what is a neural network? | Deep learning chapter 1", 3Blue1Brown, 18:40. The transcript block reports `"language": "de"`, `"languageName": "German"`, `"autoGenerated": false`, `"translatedFrom": null`, 304 cues, 2,985 words, `truncated: false`. `translatedFrom: null` means the video already has a German caption track, so the server returned it as is. The start of `transcript.content`:

```
1
00:00:04,220 --> 00:00:05,400
Das ist eine Drei.

2
00:00:06,060 --> 00:00:09,820
Sie ist schlampig geschrieben und mit einer extrem niedrigen Auflösung von 28x28

3
00:00:09,820 --> 00:00:13,720
Pixeln gerendert, aber dein Gehirn hat keine Probleme, sie als eine 3 zu erkennen.
```

`availableLanguages` lists every track and says which are translatable; `translationLanguagesCount` was 18 here. When the target language has no track of its own, YouTube machine-translates the best available one and `translatedFrom` holds the source language.

**Note:** an MCP tool returns text to the agent, and the agent decides where to write it. In Claude Code or Cursor it can save the `content` field straight to a file. A chat client without file access can only show it.

---

## Picking the right tool

- **A question about one video, with exact quotes:** `get_transcript` with `include_timestamps`.
- **"What is in this video?" or "what's the gist of these five?":** `summarize_transcript`, one flat-priced call that includes the transcript fetch.
- **Where is topic X in a long video:** `get_video_chapters`.
- **Don't have a link yet:** `search_videos`, filtered by `upload_date`, `duration` and `features`.
- **Subtitle files or other languages:** `get_transcript` with `format: "srt"` and `languages` / `translate_to`.
