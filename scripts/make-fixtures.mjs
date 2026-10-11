#!/usr/bin/env node
/**
 * Regenerates test/fixtures/ from the hand-written content below.
 * The fixtures mimic real YouTube responses (ANDROID InnerTube /player JSON,
 * srv1 / json3 timedtext, WEB /search JSON, watch-page HTML) for fictional
 * videos, so tests run offline and never depend on YouTube's availability.
 *
 *   node scripts/make-fixtures.mjs
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

const write = async (rel, data) => {
  const p = join(OUT, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// Transcript builders
// ---------------------------------------------------------------------------

/** Split sentences into caption-sized cues (~7 words) and spread them over [start, end). */
function cues(blocks, totalEnd, { wordsPerCue = 7 } = {}) {
  const out = [];
  blocks.forEach((b, bi) => {
    const end = blocks[bi + 1]?.start ?? totalEnd;
    const words = b.text.join(" ").split(/\s+/);
    const pieces = [];
    for (let i = 0; i < words.length; i += wordsPerCue) pieces.push(words.slice(i, i + wordsPerCue).join(" "));
    const step = (end - b.start) / pieces.length;
    pieces.forEach((text, i) => out.push({ start: +(b.start + i * step).toFixed(3), dur: +(step * 0.98).toFixed(3), text }));
  });
  return out;
}

const srv1 = (cs) =>
  `<?xml version="1.0" encoding="utf-8" ?><transcript>` +
  cs.map((c) => `<text start="${c.start}" dur="${c.dur}">${xmlEscape(c.text)}</text>`).join("") +
  `</transcript>`;

/** ASR-style json3: overlapping cue durations, word-level segs with offsets. */
const json3 = (cs) => ({
  wireMagic: "pb3",
  pens: [{}],
  wsWinStyles: [{}, { mhModeHint: 2, juJustifCode: 0, sdScrollDir: 3 }],
  wpWinPositions: [{}, { apPoint: 6, ahHorPos: 20, avVerPos: 100, rcRows: 2, ccCols: 40 }],
  events: [
    { tStartMs: 0, dDurationMs: Math.round((cs.at(-1).start + cs.at(-1).dur) * 1000), id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
    ...cs.flatMap((c, i) => {
      const words = c.text.split(" ");
      const ev = {
        tStartMs: Math.round(c.start * 1000),
        dDurationMs: Math.round((c.dur + 1.6) * 1000), // ASR cues overlap the next one
        wWinId: 1,
        segs: words.map((w, j) => (j === 0 ? { utf8: w, acAsrConf: 0 } : { utf8: ` ${w}`, tOffsetMs: j * 240, acAsrConf: 0 })),
      };
      return i ? [{ tStartMs: Math.round(c.start * 1000) - 10, dDurationMs: 10, wWinId: 1, aAppend: 1, segs: [{ utf8: "\n" }] }, ev] : [ev];
    }),
  ],
});

// ---------------------------------------------------------------------------
// Video 1 — punctuated manual captions + description chapters
// ---------------------------------------------------------------------------

const SOLAR_ID = "kM3pLz8QwT0";
const SOLAR_LEN = 552;
const SOLAR = [
  {
    start: 0,
    text: [
      "Hey everyone, welcome back to Bright Circuits.",
      "Today we're answering a question I get all the time: how does a flat piece of glass on a roof turn sunlight into electricity you can actually use?",
      "By the end of this video you'll understand the physics inside a solar cell, why panels are wired the way they are, and what the inverter and battery are really doing.",
    ],
  },
  {
    start: 42,
    text: [
      "Let's start with sunlight itself.",
      "Light arrives in tiny packets of energy called photons, and each photon carries an amount of energy that depends on its color.",
      "Blue photons carry more energy than red photons, and infrared photons carry less still.",
      "On a clear day at noon, roughly one thousand watts of sunlight land on every square meter of ground.",
      "That number, one kilowatt per square meter, is the standard test condition every solar panel is rated against.",
      "The whole job of a solar panel is to catch as many of those photons as possible and turn their energy into moving electrons.",
    ],
  },
  {
    start: 118,
    text: [
      "So what happens inside a silicon solar cell?",
      "A solar cell is a thin wafer of silicon that has been doped with small amounts of other elements.",
      "The top layer is doped with phosphorus, which gives it extra electrons, and the bottom layer is doped with boron, which leaves gaps called holes.",
      "Where those two layers meet, you get a p-n junction with a built-in electric field.",
      "When a photon with enough energy hits the silicon, it knocks an electron loose and leaves a hole behind.",
      "The electric field at the junction pushes the electron one way and the hole the other way, and that separation is what creates a voltage.",
      "Connect a wire from the front contacts to the back contacts and the electrons flow through it as direct current.",
      "A single silicon cell only produces about half a volt, no matter how big it is.",
      "Photons with too little energy pass straight through, and the extra energy of blue photons is lost as heat, which is why the best commercial cells convert only about twenty two percent of sunlight into electricity.",
    ],
  },
  {
    start: 220,
    text: [
      "Half a volt is not very useful on its own, so cells are combined into panels.",
      "A typical residential panel has sixty or seventy two cells wired in series, which adds their voltages together to roughly thirty to forty volts.",
      "The cells are sandwiched between tempered glass on the front and a polymer backsheet, then framed in aluminum to survive decades of weather.",
      "Because the cells are in series, shading a single cell can drag down the whole string, a bit like a kink in a garden hose.",
      "That's why modern panels include bypass diodes that let current route around a shaded group of cells.",
      "Panels are then wired together into strings on the roof to reach the voltage the inverter expects.",
    ],
  },
  {
    start: 305,
    text: [
      "Now for the part most people skip: the inverter.",
      "Solar panels produce direct current, but your home and the electrical grid run on alternating current.",
      "The inverter converts direct current into alternating current that matches the grid's voltage and frequency exactly.",
      "Good inverters also run maximum power point tracking, constantly adjusting the electrical load so the panels operate at their most efficient voltage as clouds pass and temperature changes.",
      "There are three main options: a single string inverter, microinverters on every panel, or power optimizers paired with a central inverter.",
      "Microinverters cost more, but they handle partial shading much better because every panel is tracked on its own.",
      "When your panels produce more power than the house uses, the inverter pushes the surplus onto the grid, and with net metering your utility credits you for it.",
      "For safety, a grid-tied inverter shuts down automatically during a power outage so it can't send current into lines that utility crews are repairing.",
    ],
  },
  {
    start: 408,
    text: [
      "That shutdown is exactly why batteries have become so popular.",
      "A home battery stores surplus solar energy during the day so you can use it in the evening, when demand and electricity prices are highest.",
      "Most home batteries today use lithium iron phosphate chemistry, which is safer and lasts longer than the lithium chemistry in older electric cars.",
      "A typical home battery stores between ten and fifteen kilowatt hours, enough to run the essentials through a night.",
      "With a battery and the right inverter, your system can keep the lights on during a blackout by forming its own small island grid.",
      "Batteries add significant cost, though, so whether one makes sense depends on your utility's rates and how often the power goes out.",
    ],
  },
  {
    start: 490,
    text: [
      "So, is solar worth it?",
      "For most homes with a sunny, unshaded roof, a solar system pays for itself in roughly six to ten years, and panels are usually warrantied for twenty five years.",
      "Panels slowly lose about half a percent of their output each year, so after twenty five years they still produce close to ninety percent of their original power.",
      "The key takeaway: a solar panel is just billions of photons knocking electrons loose in silicon, and everything else is about collecting, converting and storing that energy efficiently.",
      "If this helped, check out our follow-up video on sizing a system for your own home, and I'll see you in the next one.",
    ],
  },
];

const SOLAR_DESC = `Everything you need to know about how a solar panel turns sunlight into electricity — photons, silicon p-n junctions, series strings, inverters, MPPT and home batteries — explained simply with animations.

Chapters:
0:00 Intro
0:42 What sunlight is made of
1:58 Inside a silicon solar cell
3:40 From cells to panels
5:05 Inverters and the grid
6:48 Batteries and storage
8:10 Is solar worth it?

Sources and further reading:
NREL Best Research-Cell Efficiency Chart: https://www.nrel.gov/pv/cell-efficiency.html

Music: "Morning Light" by Lumen (licensed)
#solar #renewableenergy #physics`;

const SOLAR_ES = [
  {
    start: 0,
    text: [
      "Hola a todos, bienvenidos de nuevo a Bright Circuits.",
      "Hoy respondemos una pregunta muy común: ¿cómo convierte un panel solar la luz del sol en electricidad?",
    ],
  },
  { start: 42, text: ["Empecemos con la luz solar.", "La luz llega en pequeños paquetes de energía llamados fotones."] },
  { start: 118, text: ["Una celda solar es una oblea delgada de silicio dopada con otros elementos."] },
];

const SOLAR_DE = [
  {
    start: 0,
    text: [
      "Hallo zusammen, willkommen zurück bei Bright Circuits.",
      "Heute beantworten wir eine Frage, die ich ständig bekomme: Wie verwandelt eine flache Glasscheibe auf dem Dach Sonnenlicht in nutzbaren Strom?",
    ],
  },
  { start: 42, text: ["Beginnen wir mit dem Sonnenlicht selbst.", "Licht kommt in winzigen Energiepaketen an, die Photonen heißen."] },
];

// ---------------------------------------------------------------------------
// Video 2 — ASR-only captions (no punctuation), no description chapters
// ---------------------------------------------------------------------------

const BREAD_ID = "Vb7nQe2RtY4";
const BREAD_LEN = 750;
const BREAD = [
  {
    start: 0,
    text: [
      "[Music]",
      "hey guys welcome to the kitchen today we are making a classic sourdough loaf from start to finish and i promise it is easier than it looks",
      "all you need is flour water salt and an active starter so let's get into it",
    ],
  },
  {
    start: 30,
    text: [
      "so first things first the starter the night before you bake you want to feed your starter equal weights of flour and water",
      "i use fifty grams of starter fifty grams of whole wheat flour and fifty grams of water and i stir it really well",
      "a healthy starter should double in size within four to eight hours and it should smell tangy and a little bit like yogurt",
      "the float test is a quick check you drop a spoonful of starter into water and if it floats it is full of gas and ready to use",
      "if your starter is sluggish feed it two or three days in a row at a warm room temperature before you bake",
    ],
  },
  {
    start: 150,
    text: [
      "now let's mix the dough in a big bowl i combine five hundred grams of bread flour with three hundred and fifty grams of warm water",
      "mix the flour and water until there is no dry flour left and then just leave it alone for forty five minutes this rest is called the autolyse",
      "during the autolyse the flour fully hydrates and gluten starts forming on its own without any kneading",
      "after the autolyse add one hundred grams of your bubbly starter and ten grams of salt and squeeze it through the dough with wet hands",
      "the dough will feel shaggy and sticky at this point that is completely normal so do not add more flour",
    ],
  },
  {
    start: 270,
    text: [
      "okay next comes bulk fermentation which is where most of the flavor and structure develops",
      "every thirty minutes for the first two hours we do a set of stretch and folds grab one side of the dough stretch it up and fold it over the top then rotate the bowl and repeat four times",
      "with each set of stretch and folds the dough gets smoother stronger and more elastic",
      "bulk fermentation usually takes four to six hours depending on the temperature of your kitchen warmer kitchens ferment much faster",
      "you are looking for the dough to rise about fifty percent with a domed jiggly surface and bubbles on the sides of the bowl",
    ],
  },
  {
    start: 400,
    text: [
      "now we shape the loaf turn the dough out onto a lightly floured counter and pre shape it into a loose round with a bench scraper",
      "let it rest for twenty minutes then do the final shaping by folding the sides into the middle and rolling it up tightly to build surface tension",
      "place the shaped loaf seam side up in a floured banneton basket rice flour works best because it does not stick",
      "cover the basket and put it in the fridge overnight for a cold proof of twelve to sixteen hours",
      "the cold proof makes the dough much easier to score and it gives the bread that deeper sour flavor",
    ],
  },
  {
    start: 540,
    text: [
      "next morning it's time to bake put your dutch oven in the oven and preheat everything to two hundred and fifty degrees celsius for a full hour",
      "flip the cold dough onto parchment paper and score it with a razor blade one confident slash about a centimeter deep",
      "lower it into the hot dutch oven put the lid on and bake for twenty minutes the lid traps steam so the crust stays soft while the loaf springs up",
      "then remove the lid lower the oven to two hundred and thirty degrees and bake another twenty to twenty five minutes until the crust is deep brown",
    ],
  },
  {
    start: 670,
    text: [
      "finally and this is the hardest part let the bread cool on a wire rack for at least one hour before cutting it",
      "the crumb is still setting while the loaf cools so cutting it early makes the inside gummy",
      "look at that open crumb and that crackly crust that is exactly what we want",
      "if you try this recipe let me know in the comments and subscribe for more baking videos see you next time",
      "[Music]",
    ],
  },
];

// ---------------------------------------------------------------------------
// Player responses
// ---------------------------------------------------------------------------

const EXPIRE = 1760241600;
function trackUrl(id, lang, { asr = false, extra = "" } = {}) {
  const sparams = asr ? "ip,ipbits,expire,v,ei,caps,opi,xoaf" : "ip,ipbits,expire,v,ei,opi,xoaf";
  return (
    `https://www.youtube.com/api/timedtext?v=${id}&ei=hFxqZ9ZfixtureEi&${asr ? "caps=asr&" : ""}opi=112496729&xoaf=5` +
    `&hl=en&ip=0.0.0.0&ipbits=0&expire=${EXPIRE}&sparams=${sparams}` +
    `&signature=3A1F0C9E8B7D6A5F4E3D2C1B0A9F8E7D6C5B4A39.0F1E2D3C4B5A69788796A5B4C3D2E1F0A9B8C7D6&key=yt8` +
    `${asr ? "&kind=asr" : ""}&lang=${lang}${extra}`
  );
}
function track(id, lang, name, { asr = false, translatable = true, extra = "" } = {}) {
  return {
    baseUrl: trackUrl(id, lang, { asr, extra }),
    name: { runs: [{ text: asr ? `${name} (auto-generated)` : name }] },
    vssId: `${asr ? "a" : ""}.${lang}`,
    languageCode: lang,
    ...(asr ? { kind: "asr" } : {}),
    isTranslatable: translatable,
    trackName: "",
  };
}

const TRANSLATION_LANGUAGES = [
  ["af", "Afrikaans"], ["ar", "Arabic"], ["zh-Hans", "Chinese (Simplified)"], ["nl", "Dutch"], ["en", "English"],
  ["fr", "French"], ["de", "German"], ["hi", "Hindi"], ["it", "Italian"], ["ja", "Japanese"], ["ko", "Korean"],
  ["pl", "Polish"], ["pt", "Portuguese"], ["ru", "Russian"], ["es", "Spanish"], ["sv", "Swedish"], ["tr", "Turkish"],
  ["uk", "Ukrainian"],
].map(([languageCode, name]) => ({ languageCode, languageName: { runs: [{ text: name }] } }));

const responseContext = {
  visitorData: "CgtGaXh0dXJlRGF0YSiAgICABjIKCgJVUxIEGgAgOQ%3D%3D",
  serviceTrackingParams: [{ service: "GFEEDBACK", params: [{ key: "is_viewed_live", value: "False" }, { key: "logged_in", value: "0" }] }],
  maxAgeSeconds: 0,
};

function player({ id, title, author, channelId, lengthSeconds, viewCount, description, keywords = [], tracks = null, live = false }) {
  return {
    responseContext,
    playabilityStatus: { status: "OK", playableInEmbed: true, contextParams: "Q0FFU0FnZ0I=" },
    streamingData: {
      expiresInSeconds: "21540",
      formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 503567, width: 640, height: 360, qualityLabel: "360p" }],
    },
    ...(tracks
      ? {
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: tracks,
              audioTracks: [{ captionTrackIndices: tracks.map((_, i) => i), defaultCaptionTrackIndex: 0, visibility: "UNKNOWN", hasDefaultTrack: true }],
              translationLanguages: TRANSLATION_LANGUAGES,
              defaultAudioTrackIndex: 0,
            },
          },
        }
      : {}),
    videoDetails: {
      videoId: id,
      title,
      lengthSeconds: String(lengthSeconds),
      keywords,
      channelId,
      isOwnerViewing: false,
      shortDescription: description,
      isCrawlable: true,
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 }] },
      allowRatings: true,
      viewCount: String(viewCount),
      author,
      isPrivate: false,
      isUnpluggedCorpus: false,
      isLiveContent: live,
    },
    playerConfig: { audioConfig: { loudnessDb: -1.2, perceptualLoudnessDb: -15.2, enablePerFormatLoudness: true } },
    trackingParams: "CAAQu2kiEwjFixtureTrackingParams",
  };
}

const notPlayable = (status, reason, subreason, extra = {}) => ({
  responseContext,
  playabilityStatus: {
    status,
    reason,
    ...(subreason
      ? { errorScreen: { playerErrorMessageRenderer: { reason: { runs: [{ text: reason }] }, subreason: { runs: [{ text: subreason }] } } } }
      : {}),
    contextParams: "Q0FFU0FnZ0I=",
    ...extra,
  },
  trackingParams: "CAAQu2kiEwjFixtureTrackingParams",
});

// ---------------------------------------------------------------------------
// Watch pages
// ---------------------------------------------------------------------------

const watchHtml = ({ publishDate, category } = {}) => `<!DOCTYPE html><html lang="en" dir="ltr"><head><title>YouTube</title>
<script nonce="fixture">ytcfg.set({"CLIENT_CANARY_STATE":"none","DEVICE":"cbr\\u003dChrome\\u0026cbrver\\u003d131.0.0.0","INNERTUBE_API_KEY":"AIzaSyFixtureKey-0000000000000000000000","INNERTUBE_API_VERSION":"v1","INNERTUBE_CLIENT_NAME":"WEB","INNERTUBE_CLIENT_VERSION":"2.20250925.01.00","INNERTUBE_CONTEXT_CLIENT_NAME":1});</script>
</head><body>
<script nonce="fixture">var ytInitialPlayerResponse = {"microformat":{"playerMicroformatRenderer":{${publishDate ? `"publishDate":"${publishDate}","uploadDate":"${publishDate}",` : ""}${category ? `"category":"${category}",` : ""}"isFamilySafe":true}}};</script>
<script nonce="fixture">var ytInitialData = {"responseContext":{"serviceTrackingParams":[]},"contents":{"twoColumnWatchNextResults":{"results":{"results":{"contents":[]}}}}};</script>
</body></html>
`;

const captchaHtml = `<!DOCTYPE html><html><head><title>https://www.youtube.com/watch?v=CaptchaVid0</title></head><body>
<div id="infoDiv">Our systems have detected unusual traffic from your computer network. This page checks to see if it's really you sending the requests, and not a robot.</div>
<form id="captcha-form" action="index" method="post"><div id="recaptcha" class="g-recaptcha" data-sitekey="6LfwuyUTAAAAAOAmoS0fdqijC2PbbdH4kjq62Y1b" data-callback="submitCallback" data-s="fixture"></div>
<input type='hidden' name='q' value='EgS-fixture'><input type="hidden" name="continue" value="https://www.youtube.com/watch?v=CaptchaVid0"></form>
<div>IP address: 203.0.113.7<br>Time: 2026-10-11T16:00:00Z<br>URL: https://www.youtube.com/watch?v=CaptchaVid0</div></body></html>
`;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function videoRenderer({ id, title, channel, channelId, handle, length, views, published, snippet, badges = [], live = false }) {
  return {
    videoRenderer: {
      videoId: id,
      thumbnail: {
        thumbnails: [
          { url: `https://i.ytimg.com/vi/${id}/hq720.jpg?sqp=-oaymwEcCOgCEMoBSFXyq4qpAw4IARUAAIhCGAFwAcABBg==&rs=AOn4CLfixture`, width: 360, height: 202 },
          { url: `https://i.ytimg.com/vi/${id}/hq720.jpg?sqp=-oaymwEcCNAFEJQDSFXyq4qpAw4IARUAAIhCGAFwAcABBg==&rs=AOn4CLfixture`, width: 720, height: 404 },
        ],
      },
      title: { runs: [{ text: title }], accessibility: { accessibilityData: { label: `${title} ${length ?? ""}` } } },
      longBylineText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: channelId, canonicalBaseUrl: `/@${handle}` } } }] },
      ...(published ? { publishedTimeText: { simpleText: published } } : {}),
      ...(length ? { lengthText: { accessibility: { accessibilityData: { label: length } }, simpleText: length } } : {}),
      viewCountText: live ? { runs: [{ text: views }, { text: " watching" }] } : { simpleText: views },
      navigationEndpoint: { watchEndpoint: { videoId: id } },
      ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: channelId, canonicalBaseUrl: `/@${handle}` } } }] },
      shortViewCountText: { simpleText: views },
      ...(badges.length
        ? { badges: badges.map((label) => ({ metadataBadgeRenderer: { style: label === "LIVE" ? "BADGE_STYLE_TYPE_LIVE_NOW" : "BADGE_STYLE_TYPE_SIMPLE", label } })) }
        : {}),
      detailedMetadataSnippets: [{ snippetText: { runs: snippet.split("**").map((t, i) => (i % 2 ? { text: t, bold: true } : { text: t })) }, maxOneLine: false }],
      thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: live ? "LIVE" : length }, style: live ? "LIVE" : "DEFAULT" } }],
    },
  };
}

const SEARCH_P1 = [
  { id: SOLAR_ID, title: "How Solar Panels Actually Work (Explained Simply)", channel: "Bright Circuits", channelId: "UCbrightCircuits000000a1", handle: "brightcircuits", length: "9:12", views: "1,843,291 views", published: "1 year ago", snippet: "How does a flat piece of glass turn **solar** energy into electricity? Photons, silicon, inverters ...", badges: ["CC"] },
  { id: "Q7tYp2LmXa1", title: "Solar Panel Installation Start to Finish – DIY Guide", channel: "Off Grid Garage", channelId: "UCoffGridGarage000000b2", handle: "offgridgarage", length: "27:45", views: "612K views", published: "8 months ago", snippet: "Full DIY install of a 6 kW **solar panels** array, racking, wiring and inspection.", badges: ["4K", "CC"] },
  { id: "R2d9KfWq0Zc", title: "Are Solar Panels Worth It in 2026? Real Numbers", channel: "Energy Explained", channelId: "UCenergyExplained0000c3", handle: "energyexplained", length: "14:03", views: "98,402 views", published: "3 weeks ago", snippet: "We crunch payback periods, net metering and battery costs for **solar panels**." },
  { id: "LiveSol4r01", title: "LIVE: Solar farm cam – real-time output", channel: "SunWatch", channelId: "UCsunWatch000000000000d4", handle: "sunwatch", length: null, views: "1.2K", published: null, snippet: "24/7 live stream of a 5 MW **solar** farm with live production data.", badges: ["LIVE"], live: true },
  { id: "Tm8nB3vCx2Q", title: "Monocrystalline vs Polycrystalline vs Thin Film", channel: "Bright Circuits", channelId: "UCbrightCircuits000000a1", handle: "brightcircuits", length: "11:20", views: "455,120 views", published: "2 years ago", snippet: "Which **solar panel** type is best? Efficiency, cost and lifespan compared." },
  { id: "Ws5pZ0jKe7Y", title: "Why Solar Panels Lose Efficiency in Heat", channel: "Physics Shorts", channelId: "UCphysicsShorts00000000e5", handle: "physicsshorts", length: "4:58", views: "2.3M views", published: "5 years ago", snippet: "Temperature coefficients explained: why hot **solar panels** produce less power." },
];
const SHELF_VIDEO = { id: "Shelf0Vid01", title: "People also watched: Tesla Powerwall review", channel: "Tech Home", channelId: "UCtechHome00000000000f6", handle: "techhome", length: "18:02", views: "3M views", published: "2 years ago", snippet: "Powerwall review" };
const SEARCH_P2 = [
  { id: "Hx4cV9bN1mA", title: "Solar Inverters Explained: String vs Micro vs Optimizers", channel: "Energy Explained", channelId: "UCenergyExplained0000c3", handle: "energyexplained", length: "16:37", views: "201K views", published: "1 year ago", snippet: "Choosing an inverter for your **solar panels**." },
  { id: "Pn6sQ1wEr4T", title: "I Put Solar Panels on My Van", channel: "Van Life Labs", channelId: "UCvanLifeLabs000000000g7", handle: "vanlifelabs", length: "22:10", views: "1M views", published: "4 years ago", snippet: "400 W of **solar panels** on a camper van roof." },
  { id: "Kc2mL8pYt5U", title: "Cleaning Solar Panels: Does It Matter?", channel: "Off Grid Garage", channelId: "UCoffGridGarage000000b2", handle: "offgridgarage", length: "7:41", views: "No views", published: "2 days ago", snippet: "Testing dirty vs clean **solar panels** output." },
];

const searchPage1 = {
  responseContext: { ...responseContext, mainAppWebResponseContext: { loggedOut: true } },
  estimatedResults: "48200000",
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  ...SEARCH_P1.slice(0, 3).map(videoRenderer),
                  {
                    shelfRenderer: {
                      title: { simpleText: "People also watched" },
                      content: { verticalListRenderer: { items: [videoRenderer(SHELF_VIDEO)], collapsedItemCount: 1 } },
                    },
                  },
                  ...SEARCH_P1.slice(3).map(videoRenderer),
                ],
                trackingParams: "CAAQuy8YAiITfixture",
              },
            },
            {
              continuationItemRenderer: {
                trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
                continuationEndpoint: {
                  clickTrackingParams: "CAAQui8iEwfixture",
                  commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: "/youtubei/v1/search" } },
                  continuationCommand: { token: "CONT_solar_p2", request: "CONTINUATION_REQUEST_TYPE_SEARCH" },
                },
              },
            },
          ],
          trackingParams: "CAAQui8iEwfixture",
          subMenu: {},
          hideBottomSeparator: true,
          targetId: "search-feed",
        },
      },
    },
  },
  trackingParams: "CAAQ7VAiEwfixture",
  topbar: {},
  refinements: ["solar panels on roof", "how solar panels work", "solar panels for home"],
};

const searchPage2 = {
  responseContext,
  trackingParams: "CAAQ7VAiEwfixture2",
  onResponseReceivedCommands: [
    {
      clickTrackingParams: "CAAQ7VAiEwfixture2",
      appendContinuationItemsAction: {
        continuationItems: [
          { itemSectionRenderer: { contents: SEARCH_P2.map(videoRenderer), trackingParams: "CAAQuy8YAiITfixture2" } },
        ],
        targetId: "search-feed",
      },
    },
  ],
};

const searchEmpty = {
  responseContext,
  estimatedResults: "0",
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [{ backgroundPromoRenderer: { title: { runs: [{ text: "No results found" }] }, bodyText: { runs: [{ text: "Try different keywords or remove search filters" }] } } }],
              },
            },
          ],
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------

async function main() {
  await rm(OUT, { recursive: true, force: true });

  // Video 1: Solar (manual en + es, auto en, translatable)
  await write(
    `player/${SOLAR_ID}.json`,
    player({
      id: SOLAR_ID,
      title: "How Solar Panels Actually Work (Explained Simply)",
      author: "Bright Circuits",
      channelId: "UCbrightCircuits000000a1",
      lengthSeconds: SOLAR_LEN,
      viewCount: 1843291,
      description: SOLAR_DESC,
      keywords: ["solar panels", "how solar panels work", "photovoltaic", "inverter", "home battery"],
      tracks: [track(SOLAR_ID, "en", "English"), track(SOLAR_ID, "es", "Spanish"), track(SOLAR_ID, "en", "English", { asr: true })],
    }),
  );
  await write(`watch/${SOLAR_ID}.html`, watchHtml({ publishDate: "2025-03-14T07:00:12-07:00", category: "Education" }));
  await write(`timedtext/${SOLAR_ID}.en.xml`, srv1(cues(SOLAR, SOLAR_LEN)));
  await write(`timedtext/${SOLAR_ID}.es.xml`, srv1(cues(SOLAR_ES, 200)));
  await write(`timedtext/${SOLAR_ID}.en.to-de.xml`, srv1(cues(SOLAR_DE, 120)));

  // Video 2: Sourdough (ASR only, json3, no chapters)
  await write(
    `player/${BREAD_ID}.json`,
    player({
      id: BREAD_ID,
      title: "Sourdough Bread for Beginners – The Full Process",
      author: "Crumb & Crust",
      channelId: "UCcrumbAndCrust0000000h8",
      lengthSeconds: BREAD_LEN,
      viewCount: 734502,
      description:
        "My no-fuss sourdough method for beginners: feeding the starter, autolyse, stretch and folds, shaping, cold proof and baking in a Dutch oven.\n\nRecipe (1 loaf): 500 g bread flour, 350 g water, 100 g active starter, 10 g salt.\n\nGear I use: https://example.com/gear\nInstagram: @crumbandcrust",
      keywords: ["sourdough", "bread", "baking", "recipe"],
      tracks: [track(BREAD_ID, "en", "English", { asr: true })],
    }),
  );
  await write(`watch/${BREAD_ID}.html`, watchHtml({ publishDate: "2024-11-02T09:30:00-07:00", category: "Howto & Style" }));
  await write(`timedtext/${BREAD_ID}.en.asr.json`, json3(cues(BREAD, BREAD_LEN, { wordsPerCue: 8 })));

  // Video 3: playable, captions disabled, but description chapters (tracklist)
  await write(
    "player/NoCapt10n00.json",
    player({
      id: "NoCapt10n00",
      title: "Lo-fi Beats to Study To – 1 Hour Mix",
      author: "Quiet Hours",
      channelId: "UCquietHours0000000000i9",
      lengthSeconds: 3600,
      viewCount: 5120933,
      description:
        "One hour of calm lo-fi for focus.\n\nTracklist\n00:00 Rainy Window\n04:12 Late Train\n09:47 Paper Lanterns\n15:30 Slow Coffee\n22:05 City Lights (feat. Mira)\n31:58 Notebook Margins\n40:20 Last Bus Home\n52:44 Sunrise Tape\n\nAll tracks © Quiet Hours",
      tracks: null,
    }),
  );

  // Error cases
  await write("player/Pr1vAtEvid0.json", {
    ...notPlayable("LOGIN_REQUIRED", "This video is private", null),
    playabilityStatus: {
      status: "LOGIN_REQUIRED",
      reason: "This video is private",
      messages: ["This is a private video. Please sign in to verify that you may see it."],
      contextParams: "Q0FFU0FnZ0I=",
    },
  });
  await write(
    "player/AgeRstrct01.json",
    notPlayable("LOGIN_REQUIRED", "Sign in to confirm your age", "This video may be inappropriate for some users.", { desktopLegacyAgeGateReason: 1 }),
  );
  await write("player/B0tCheck000.json", notPlayable("LOGIN_REQUIRED", "Sign in to confirm you’re not a bot", "This helps protect our community. Learn more"));
  await write("player/Unavail0000.json", notPlayable("ERROR", "This video is unavailable", "Sorry about that."));
  await write("player/MembersOnly.json", notPlayable("UNPLAYABLE", "Join this channel to get access to members-only content like this video, and other exclusive perks.", null));
  await write("player/RateLimit00.json", { __fixture: { status: 429, body: "<html><body>Too Many Requests</body></html>" } });
  await write("watch/CaptchaVid0.html", captchaHtml);
  const simple = (id, title, tracks) =>
    player({ id, title, author: "Fixture Channel", channelId: "UCfixture00000000000000j0", lengthSeconds: 60, viewCount: 10, description: "", tracks });
  await write("player/PoTokenVid0.json", simple("PoTokenVid0", "Needs a PO token", [track("PoTokenVid0", "en", "English", { extra: "&exp=xpe" })]));
  await write("player/EmptyCapt00.json", simple("EmptyCapt00", "Empty caption file", [track("EmptyCapt00", "en", "English")]));
  await write("timedtext/EmptyCapt00.en.xml", "");
  await write("player/FrenchOnly0.json", simple("FrenchOnly0", "Vidéo en français", [track("FrenchOnly0", "fr", "French", { translatable: false })]));
  await write(
    "timedtext/FrenchOnly0.fr.xml",
    srv1(cues([{ start: 0, text: ["Bonjour à tous, aujourd'hui on parle de cuisine.", "C'est une recette très simple."] }], 20)),
  );

  await write("watch/_default.html", watchHtml());

  // Search
  await write("search/solar-panels.json", searchPage1);
  await write("search/continuation-CONT_solar_p2.json", searchPage2);
  await write("search/_default.json", searchEmpty);

  console.log(`fixtures written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
