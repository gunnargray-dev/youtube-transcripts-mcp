<p align="center"><img src="https://raw.githubusercontent.com/gunnargray-dev/youtube-transcripts-mcp/main/assets/logo.png" width="96" alt="YouTube Transcripts MCP logo"></p>

# YouTube Transcripts MCP Server

> **Hosted version (no setup):** [apify.com/parallelstudio/youtube-transcripts-mcp](https://apify.com/parallelstudio/youtube-transcripts-mcp). Connect any MCP client to `https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp` with your Apify token, pay per call. This repo is the open-source code; you can also run it locally with `npm install && npm run build && node dist/index.js` (stdio).

<!-- mcp-name: io.github.gunnargray-dev/youtube-transcripts-mcp -->

Give your AI agent **YouTube transcripts, search, chapters and summaries**. This [MCP](https://modelcontextprotocol.io) server fetches the captions of any public YouTube video (as plain text, timestamped segments or SRT) together with its metadata. It also searches YouTube, returns chapters, and builds structured extractive summaries where every point links to the moment it comes from.

**Worked examples:** four end-to-end workflows with prompts, tool calls, costs and real output are in [docs/workflows.md](docs/workflows.md).

It works with Claude Desktop, Claude Code, Cursor, VS Code, Windsurf and any other client that supports MCP over Streamable HTTP. You don't need a YouTube API key or a Google account. No LLM runs on the server, so you don't pay for anyone else's tokens.

## What you can do with it

- **Research faster.** "Summarize this 2-hour podcast and give me the 10 key points with timestamps."
- **Answer questions about a video.** Load the transcript and let your agent quote and cite exact moments.
- **Navigate long videos.** Get the creator's chapters. If the video has none, get topic segments derived from the transcript.
- **Find sources.** Search YouTube with filters for upload date, length, sort order and "has subtitles", then pull transcripts for the best hits.
- **Repurpose content.** Export SRT subtitles, build show notes, or draft a blog post from a talk, using any caption language or YouTube's machine translation.

## Tools

| Tool | What it does | Key parameters |
|---|---|---|
| `get_transcript` | Returns the transcript plus metadata: title, channel, duration, views, publish date, category, the **available caption languages** and whether the returned track is **auto-generated**. Output can be plain text, `[m:ss]`-timestamped paragraphs, `{start, duration, text}` segments or SRT. YouTube can also machine-translate it. | `video`, `languages` (priority list, default `["en"]`), `format` (`text` \| `segments` \| `srt`), `include_timestamps`, `translate_to`, `allow_auto_generated`, `fallback_to_any_language`, `max_chars` |
| `search_videos` | Searches YouTube through the same InnerTube search API the website uses. Returns id, title, channel, duration, views, relative publish time, description snippet, thumbnail, live flag and badges. Fetches more pages automatically up to `limit`. | `query`, `limit` (1–50), `upload_date` (`hour`…`year`), `duration` (`short` <4 min, `medium` 4–20 min, `long` >20 min), `sort_by`, `features` (e.g. `subtitles`, `live`, `hd`, `creative_commons`), `hl`, `gl` |
| `get_video_chapters` | Returns chapters with start and end times and deep links. Uses the creator's chapters from the description or YouTube's chapter markers. If there are none, it derives topic segments from the transcript and titles each one with its distinctive keywords and a representative sentence. | `video`, `source` (`auto` \| `description` \| `transcript`), `languages`, `target_chapters` |
| `summarize_transcript` | Builds a structured **extractive** summary without an LLM: a TL;DR, de-duplicated key points, keywords and keyphrases, bullets per chapter, and notable quotes. Each item has a timestamp and a `…&t=123s` link. | `video`, `max_points` (1–30, default 8), `languages`, `bullets_per_chapter`, `max_quotes`, `keyword_limit` |

`video` accepts an 11-character id (`dQw4w9WgXcQ`) or any YouTube URL: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `m.` and `music.` hosts, and `youtube-nocookie.com`.

All tools are read-only.

### Error codes

Failures come back as MCP tool errors (`isError: true`). The text starts with `Error (<CODE>): …` and `structuredContent.error` holds `{ code, message, retryable, details }`, so your agent can react to the code instead of parsing the message:

| Code | Meaning |
|---|---|
| `INVALID_VIDEO_ID` / `INVALID_INPUT` | The video id/URL or another argument is invalid |
| `VIDEO_UNAVAILABLE` | Removed, never existed, or the id is wrong |
| `VIDEO_PRIVATE` | The video is private |
| `AGE_RESTRICTED` | YouTube requires a signed-in account (age gate) |
| `VIDEO_UNPLAYABLE` | Members-only, region-blocked, upcoming live stream, etc. (`details.reason` has YouTube's text) |
| `TRANSCRIPTS_DISABLED` | The video has no captions at all |
| `NO_TRANSCRIPT_FOUND` | None of the requested languages exist and `fallback_to_any_language` is `false`. `details.available` lists the tracks that do exist |
| `TRANSLATION_UNAVAILABLE` | YouTube can't translate this track into `translate_to` |
| `NO_CHAPTERS` | `source: "description"` was requested, but the description has no chapter list |
| `REQUEST_BLOCKED` | YouTube blocked the request (HTTP 429, reCAPTCHA or "confirm you're not a bot") even after the server rotated proxy sessions. `retryable: true` |
| `PO_TOKEN_REQUIRED` / `EMPTY_TRANSCRIPT` | YouTube served a caption URL that needs a PO token, or an empty caption file |
| `UPSTREAM_ERROR` / `INTERNAL_ERROR` | Timeouts, 5xx responses or unexpected response shapes |

## Pricing

This Actor uses **pay-per-event** pricing. Tool events are charged only for successful tool calls. Failed calls are **not** charged as tool events, whether they fail on validation, because the video is private or has no captions, or because YouTube blocks the request. Apify also charges its standard **Actor start** event ($0.00005 per GB of memory, minimum one event) each time a server instance starts. At the default 512 MB standby memory that's $0.00005 per start, and one running instance serves many calls before it idles out. The **Pricing** tab on this Actor is the authoritative list of current prices.

| Event | Price | When it's charged | Count |
|---|---|---|---|
| `transcript` | $0.005 | Each successful `get_transcript` call | 1 per call, whatever the video length or format |
| `search` | $0.003 | Each successful `search_videos` call | 1 per call (up to 50 results, including extra pages fetched automatically) |
| `chapters` | $0.008 | Each successful `get_video_chapters` call | 1 per call, from the description or derived from the transcript |
| `summary` | $0.015 | Each successful `summarize_transcript` call | 1 per call. The transcript fetched internally is **not** charged separately as `transcript` |

A search that returns zero results is still a successful call and is charged as one `search` event.

## Connect your MCP client

Endpoint (Streamable HTTP):

```
https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp
```

Authenticate with your [Apify API token](https://console.apify.com/settings/integrations) by sending it as `Authorization: Bearer <APIFY_TOKEN>`.

### Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "youtube-transcripts": {
      "url": "https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp",
      "headers": {
        "Authorization": "Bearer <APIFY_TOKEN>"
      }
    }
  }
}
```

### Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "youtube-transcripts": {
      "serverUrl": "https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp",
      "headers": {
        "Authorization": "Bearer <APIFY_TOKEN>"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Claude Desktop's config file only launches local (stdio) servers, so bridge to the hosted endpoint with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (needs Node.js). The same block works in any other client that only supports stdio:

```json
{
  "mcpServers": {
    "youtube-transcripts": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp",
        "--header", "Authorization: Bearer ${APIFY_TOKEN}"
      ],
      "env": { "APIFY_TOKEN": "<APIFY_TOKEN>" }
    }
  }
}
```

### Clients that can't send headers

Apify also accepts the token as a `token` query parameter, so a client that only takes a URL can use:

```
https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp?token=<APIFY_TOKEN>
```

Prefer the `Authorization` header when your client supports it: a token in a URL can end up in logs. A [scoped Apify token](https://docs.apify.com/integrations/api) limits the damage if it leaks.

### Claude Code

```bash
claude mcp add --transport http youtube-transcripts \
  https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp \
  --header "Authorization: Bearer $APIFY_TOKEN"
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "youtube-transcripts": {
      "type": "http",
      "url": "https://parallelstudio--youtube-transcripts-mcp.apify.actor/mcp",
      "headers": { "Authorization": "Bearer ${input:apifyToken}" }
    }
  },
  "inputs": [{ "id": "apifyToken", "type": "promptString", "description": "Apify API token", "password": true }]
}
```

### Example prompts

- "Get the transcript of https://youtu.be/aircAruvnKk and explain the part about gradient descent, citing timestamps."
- "Search for talks about Rust async from the last year, longer than 20 minutes and with subtitles, then summarize the top 3."
- "Give me the chapters of this 3-hour livestream. If it has none, split it by topic."
- "Export German subtitles for this video as SRT. Translate them if there's no German track."

Four of these, with the exact tool calls, per-call costs and real output from live YouTube videos, are in [docs/workflows.md](docs/workflows.md):

| Workflow | Tools | Cost per run |
|---|---|---|
| [Research a long talk and answer with timestamp citations](docs/workflows.md#1-research-a-long-talk-and-answer-with-timestamp-citations) | `get_transcript` | $0.005 |
| [Search a topic and summarize the top results](docs/workflows.md#2-search-a-topic-and-summarize-the-top-results) | `search_videos` + 3 × `summarize_transcript` | $0.048 |
| [Chapters for a long video that has none](docs/workflows.md#3-chapters-for-a-long-video-that-has-none) | `get_video_chapters` | $0.008 |
| [Export subtitles as SRT, in another language](docs/workflows.md#4-export-subtitles-as-srt-in-another-language) | `get_transcript` | $0.005 |

## Example outputs

The excerpts below come from the bundled fixture videos used in the test suite (see [`demo/transcript.md`](demo/transcript.md) for every call and response).

**`get_transcript`** `{ "video": "kM3pLz8QwT0", "format": "segments", "include_timestamps": true }` (trimmed):

```json
{
  "video": {
    "id": "kM3pLz8QwT0",
    "url": "https://www.youtube.com/watch?v=kM3pLz8QwT0",
    "title": "How Solar Panels Actually Work (Explained Simply)",
    "channel": "Bright Circuits",
    "durationSeconds": 552,
    "duration": "9:12",
    "viewCount": 1843291,
    "publishDate": "2025-03-14T07:00:12-07:00",
    "category": "Education",
    "isLive": false
  },
  "transcript": {
    "language": "en",
    "languageName": "English",
    "autoGenerated": false,
    "translatedFrom": null,
    "matchedPreference": true,
    "format": "segments",
    "segmentCount": 128,
    "wordCount": 870,
    "truncated": false,
    "segments": [
      { "start": 0, "duration": 4.116, "time": "0:00", "text": "Hey everyone, welcome back to Bright Circuits." },
      { "start": 4.2, "duration": 4.116, "time": "0:04", "text": "Today we're answering a question I get" }
    ]
  },
  "availableLanguages": [
    { "languageCode": "en", "languageName": "English", "autoGenerated": false, "translatable": true },
    { "languageCode": "es", "languageName": "Spanish", "autoGenerated": false, "translatable": true },
    { "languageCode": "en", "languageName": "English", "autoGenerated": true, "translatable": true }
  ],
  "translationLanguagesCount": 18
}
```

**`get_video_chapters`** on a video with no creator chapters (auto-captions only). The chapters are derived from the transcript:

| # | start | title (distinctive keywords) |
|---|---|---|
| 1 | 0:00 | Starter, water, grams |
| 2 | 2:00 | Autolyse, grams, warm |
| 3 | 4:11 | Stretch, folds, bulk |
| 4 | 5:52 | Cold, sides, surface |
| 5 | 9:34 | Lid |
| 6 | 10:30 | Cool, cutting, crumb |

**`summarize_transcript`** `{ "video": "kM3pLz8QwT0", "max_points": 6 }` (excerpt):

- **Key points:** [2:32] *When a photon with enough energy hits the silicon, it knocks an electron loose and leaves a hole behind.* · [5:09] *Solar panels produce direct current, but your home and the electrical grid run on alternating current.* · [6:52] *A home battery stores surplus solar energy during the day so you can use it in the evening…*
- **Keywords:** panels, cells, inverter, photons, solar, energy, battery, current, solar panel, electrons
- **Chapter bullets** use the creator's 7 chapters ("Inside a silicon solar cell", "Inverters and the grid"…), with 2 bullets each.
- **Quotes:** *"The inverter converts direct current into alternating current that matches the grid's voltage and frequency exactly."* [5:18]

## How it works

### Transcripts

The server fetches transcripts the same way the popular Python library [`youtube-transcript-api`](https://github.com/jdepoix/youtube-transcript-api) does:

1. Load the watch page. If YouTube shows the EU cookie-consent page, accept it. A reCAPTCHA page is reported as `REQUEST_BLOCKED`. The page also yields the InnerTube API key, the publish date, the category and any chapter markers.
2. Call the InnerTube **player** API with the **ANDROID** client context. This returns the video details and the `captionTracks`. The playability status is mapped to the error codes above: private, age-restricted, unavailable, unplayable, or "confirm you're not a bot".
3. Pick a track. For each preferred language in order, manual captions beat auto-generated ones, and an exact code match beats a base-language match (`en-GB` → `en`). Then download the timedtext file. The server parses srv1 XML, srv3 XML and json3.

All three requests for a video go through **one proxy session**, because YouTube signs caption URLs for the IP that requested them.

### Getting past YouTube's IP blocks

YouTube blocks most cloud IPs. In a feasibility probe from Apify, direct requests fetched **1 of 5** test videos. With Apify's datacenter proxy, **4 of 5** worked, and the fifth video simply has no transcript. On the Apify platform this server therefore routes every YouTube request through **Apify Proxy** (datacenter by default), using sticky sessions and an `undici` `ProxyAgent`. When YouTube blocks a session (429, captcha, bot check, empty caption file, network error), the server discards that session and retries with a new IP, up to 5 sessions per call. A healthy session is reused for later calls.

### Chapters derived from the transcript

When a video has no creator chapters, the server segments the transcript in a TextTiling style:

1. Split the transcript into 20–60 s time blocks and build a TF-IDF vector for each block.
2. At each gap between blocks, compare the vocabulary of the two blocks before it with the two blocks after it (cosine similarity). A sharp dip means the topic changed.
3. Keep the deepest dips, subject to a minimum chapter length. Then split any chapter that is still much longer than average (time-window fallback).
4. Snap each boundary to the nearest sentence start. Title each chapter with the keywords that set it apart from the other chapters, and attach its most central sentence.

### Summaries without an LLM

1. Build sentences. Punctuated captions are split on punctuation. Auto-captions have no punctuation, so they are re-timed word by word and cut into short chunks at discourse markers ("so", "now", "next"…) and pauses. `[Music]`-style tags are removed.
2. Rank sentences with **TextRank**: PageRank over a graph weighted by TF-IDF cosine similarity. Very short fragments are down-weighted.
3. Choose key points, chapter bullets and quotes with **MMR** (Maximal Marginal Relevance), so near-duplicates don't repeat. Then put them back in chronological order.
4. Score keywords by frequency, weighted by an IDF over 1-minute windows. Unigrams already covered by a selected bigram are dropped.

The method is deterministic and transparent, and it is fast: milliseconds after the transcript is fetched. Because it quotes the speaker's own words, it can't hallucinate.

## Limitations

- **Public captions only.** Private, members-only and age-restricted videos fail with clear error codes. The server never signs in.
- **Quality depends on the captions.** Auto-generated captions have no punctuation and some recognition errors. Summaries and derived chapters handle this, but creator captions give better sentences.
- **Extractive, not abstractive.** Summaries quote sentences from the transcript; they don't paraphrase. The stopword list and stemming are tuned for English. Other languages still work, with somewhat noisier keywords.
- **Search returns videos only.** Channels, playlists and Shorts shelves are excluded, and so are "People also watched" recommendations. Relative dates ("3 weeks ago") are passed through exactly as YouTube shows them.
- **Unofficial endpoints.** InnerTube and timedtext are the APIs YouTube's own apps use, but they are undocumented and can change. The server retries with backoff and rotates proxies. Responses are cached in memory for 10 minutes.
- **Live streams.** Ongoing live streams usually have no transcript until they end.

## FAQ

**Do I need a YouTube Data API key or a Google account?**
No. You only need an Apify account and token to call this hosted server.

**Which languages are supported?**
Any language YouTube has captions for. Pass a priority list such as `["de", "en"]`. If none of them exist, the best available track is returned along with a note, unless you set `fallback_to_any_language: false`. With `translate_to`, YouTube machine-translates the track.

**How long can videos be?**
There's no fixed limit. A transcript costs one `transcript` event however long it is. For very long videos, use `max_chars` or `summarize_transcript` to keep your agent's context small.

**Why did I get `REQUEST_BLOCKED`?**
YouTube rejected every proxy IP the server tried for that call. This is usually temporary, so retry after a short pause. Blocked calls are not charged.

**Is any data stored?**
No. The server is stateless and keeps only a short in-memory cache. It writes nothing to datasets or key-value stores.

**Can I self-host it?**
Yes. See below. Residential IPs can usually reach YouTube directly. On cloud servers, set `YT_PROXY_URL`.

## Self-hosting and development

```bash
npm install
npm run build
npm start              # MCP over stdio
npm run start:http     # Streamable HTTP at http://127.0.0.1:3000/mcp (GET / and /health = readiness)
npm test               # build + unit tests + MCP smoke test, all offline against recorded fixtures
```

| env var | default | purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP bind (`--http`); also `--port`, `--host` |
| `YT_PROXY_URL` | _(unset)_ | Your own proxy or proxies: comma-separated `http://user:pass@host:port` URLs, one sticky URL per session, round-robin |
| `YT_PROXY` | _(unset)_ | `off` disables proxying, even on Apify |
| `YT_PROXY_GROUPS` / `YT_PROXY_COUNTRY` | datacenter / any | Apify Proxy groups (e.g. `RESIDENTIAL`) and country code on the platform |
| `YT_PROXY_ATTEMPTS` | `5` | Proxy sessions tried per call before returning `REQUEST_BLOCKED` |
| `YT_FIXTURES` | _(unset)_ | Serve all YouTube requests from a fixture directory (offline mode, used by tests) |
| `HTTP_TIMEOUT_MS` | `8000` | Per-request timeout (a stalled proxy exit is rotated, not waited for) |
| `HTTP_MAX_RETRIES` | `2` | In-place retries on 5xx/timeouts for direct (unproxied) connections only; proxied calls rotate session instead |
| `YT_KEEP_ALIVE_MS` | `60000` | Idle keep-alive of the proxy tunnel between calls |
| `YT_SLOW_SESSION_MS` | `6000` | A proxy session whose operation took longer is retired so the next call gets a fresh IP |
| `CACHE_TTL_MS` | `600000` | In-memory cache TTL (`0` disables) |
| `BILLING` | _(unset)_; `apify` in the Docker image | `apify` enables `Actor.charge()` pay-per-event billing; `log` only prints charges to stderr |

**On Apify (Standby mode).** When `APIFY_IS_AT_HOME` is set, the server calls `Actor.init()`, forces HTTP mode, and listens on `0.0.0.0:$ACTOR_WEB_SERVER_PORT`. `GET /` answers the Standby readiness probe and MCP is served at `/mcp`. YouTube traffic goes through Apify Proxy. The HTTP server has no authentication of its own: on Apify, the platform authenticates requests with your API token. If you self-host it beyond localhost, put it behind an auth proxy.

### Tests

- **Unit tests** (`test/unit/*.test.mjs`, `node --test`) run against hand-made fixtures that mirror real YouTube responses: ANDROID player JSON, srv1/json3 timedtext, WEB search pages with continuations and shelves, watch pages including a reCAPTCHA page, and every error status. They cover parsing, track selection, description and derived chapters, TextRank and summaries, the search `params` encoding, error mapping, and proxy session rotation.
- **MCP smoke test** (`test/smoke.mjs`) spawns the server over stdio with `YT_FIXTURES`, lists the tools, calls each tool (including error paths), checks that billing charges only successful calls, checks HTTP mode and the readiness probe, and writes `demo/transcript.{json,md}`.
- **Live remote test** (`test/live-remote.mjs`, not part of `npm test`) runs against a deployed Standby URL: `MCP_URL=… APIFY_TOKEN=… node test/live-remote.mjs`.
- `npm run fixtures` regenerates `test/fixtures/` from `scripts/make-fixtures.mjs`.

```
.actor/        actor.json (Standby, /mcp), input_schema.json (empty), output_schema.json (MCP endpoint)
Dockerfile     apify/actor-node:20, multi-stage TypeScript build, BILLING=apify
src/
  index.ts       entry: stdio or stateless Streamable HTTP; Apify Standby wiring
  server.ts      MCP tool registrations (zod schemas, error payloads, billing)
  youtube.ts     watch page → InnerTube player (ANDROID) → timedtext; track selection; error mapping
  transcript.ts  srv1/srv3/json3 parsing; text / SRT formatting
  search.ts      InnerTube search, protobuf filter params, continuation paging
  chapters.ts    description chapter parser; TextTiling-style derived chapters
  text.ts        tokenizer, stemmer, sentences, TF-IDF, TextRank, keywords
  summary.ts     extractive summary (key points, chapter bullets, quotes, stats)
  http.ts        timeouts/retries, proxy sessions + rotation, fixture mode
  proxy.ts       Apify Proxy / YT_PROXY_URL selection
  fixtures.ts    offline fixture resolver
  billing.ts     chargeEvent() → Actor.charge() when BILLING=apify
  util.ts        error codes, cache, id/URL parsing, time helpers
```

## Related

- [App Store & Google Play Review Intelligence MCP](https://apify.com/parallelstudio/app-store-review-intelligence-mcp): the same pay-per-call setup for app reviews. Your agent gets top complaints, rating by app version, regressions after a release, and side-by-side competitor comparisons for any iOS or Android app. Source: [GitHub](https://github.com/gunnargray-dev/app-store-review-intelligence-mcp).

## License

MIT
