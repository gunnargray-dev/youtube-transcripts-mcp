/** Proxy session rotation on block, using a fake network client (no real requests). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dist, rejection } from "./helpers.mjs";

delete process.env.YT_FIXTURES;
delete process.env.APIFY_IS_AT_HOME;
process.env.YT_PROXY_ATTEMPTS = "4";
const http = await dist("http.js");
const proxy = await dist("proxy.js");
const { YouTubeError, ErrorCodes } = await dist("util.js");

const blocked = () => new YouTubeError(ErrorCodes.REQUEST_BLOCKED, "HTTP 429", { httpStatus: 429 });

test("no proxy configured outside Apify; fixtures disable proxying", async () => {
  delete process.env.YT_PROXY_URL;
  proxy.resetProxyProvider();
  assert.equal(await proxy.getProxyProvider(), null);
  process.env.YT_FIXTURES = "/tmp";
  process.env.YT_PROXY_URL = "http://user:pass@proxy.example:8000";
  proxy.resetProxyProvider();
  assert.equal(await proxy.getProxyProvider(), null);
  delete process.env.YT_FIXTURES;
});

test("static YT_PROXY_URL provider is sticky per session and round-robins", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1, http://b.example:2";
  proxy.resetProxyProvider();
  const p = await proxy.getProxyProvider();
  assert.equal(p.label, "custom (2 urls)");
  const s1 = await p.newUrl("s1");
  assert.equal(await p.newUrl("s1"), s1);
  assert.notEqual(await p.newUrl("s2"), s1);
  assert.match(proxy.newSessionId(), /^[\w._~]{1,50}$/);
});

test("withYouTube rotates to a new proxy session when blocked", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1,http://b.example:2";
  proxy.resetProxyProvider();
  const sessions = [];
  http.setLiveClientFactoryForTests((_dispatcher, sessionId) => ({
    sessionId,
    async request() {
      sessions.push(sessionId);
      if (sessions.length < 3) throw blocked();
      return { status: 200, text: "ok", url: "https://www.youtube.com/" };
    },
  }));
  const res = await http.withYouTube(async (client, ctx) => ({ body: (await client.request({ method: "GET", url: "x" })).text, ctx }));
  assert.equal(res.body, "ok");
  assert.equal(res.ctx.attempts, 3);
  assert.match(res.ctx.proxy, /^custom/);
  assert.equal(new Set(sessions).size, 3, "a fresh session per attempt");

  // The healthy session is reused for the next operation.
  const before = sessions.length;
  await http.withYouTube((client) => client.request({ method: "GET", url: "x" }));
  assert.equal(sessions[before], sessions[before - 1]);
});

test("withYouTube gives up after YT_PROXY_ATTEMPTS and reports it", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1";
  proxy.resetProxyProvider();
  let calls = 0;
  http.setLiveClientFactoryForTests((_d, sessionId) => ({
    sessionId,
    async request() {
      calls++;
      throw blocked();
    },
  }));
  const err = await rejection(http.withYouTube((c) => c.request({ method: "GET", url: "x" })));
  assert.equal(err.code, "REQUEST_BLOCKED");
  assert.equal(calls, 4);
  assert.equal(err.details.attempts, 4);
  assert.match(err.message, /after 4 proxy sessions/);
});

test("non-retryable errors are not retried; no-proxy block explains how to fix", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1";
  proxy.resetProxyProvider();
  let calls = 0;
  http.setLiveClientFactoryForTests((_d, sessionId) => ({
    sessionId,
    async request() {
      calls++;
      throw new YouTubeError(ErrorCodes.VIDEO_PRIVATE, "private");
    },
  }));
  const err = await rejection(http.withYouTube((c) => c.request({ method: "GET", url: "x" })));
  assert.equal(err.code, "VIDEO_PRIVATE");
  assert.equal(calls, 1);

  delete process.env.YT_PROXY_URL;
  proxy.resetProxyProvider();
  http.setLiveClientFactoryForTests(() => ({ sessionId: null, request: async () => { throw blocked(); } }));
  const direct = await rejection(http.withYouTube((c) => c.request({ method: "GET", url: "x" })));
  assert.equal(direct.code, "REQUEST_BLOCKED");
  assert.match(direct.message, /YT_PROXY_URL/);
  http.setLiveClientFactoryForTests(null);
});

test("one ProxyAgent and one newUrl per session: reused across operations, rotated only on a block", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1,http://b.example:2";
  proxy.resetProxyProvider();
  http.resetSessionsForTests();
  const provider = await proxy.getProxyProvider();
  let newUrlCalls = 0;
  const realNewUrl = provider.newUrl.bind(provider);
  provider.newUrl = async (id) => (newUrlCalls++, realNewUrl(id));
  const made = [];
  http.setAgentFactoryForTests((uri) => {
    const agent = { uri, close: async () => {} };
    made.push(agent);
    return agent;
  });
  const dispatchers = [];
  let blockNext = false;
  http.setLiveClientFactoryForTests((dispatcher, sessionId) => ({
    sessionId,
    async request() {
      dispatchers.push(dispatcher);
      if (blockNext) {
        blockNext = false;
        throw blocked();
      }
      return { status: 200, text: "ok", url: "x" };
    },
  }));
  const run = () => http.withYouTube((c, ctx) => c.request({ method: "GET", url: "x" }).then(() => ctx));

  const first = await run();
  assert.equal(first.attempts, 1);
  for (let i = 0; i < 5; i++) await run();
  assert.equal(made.length, 1, "a single agent serves all sessions-sticky calls");
  assert.equal(newUrlCalls, 1, "newUrl is not called per request");
  assert.equal(new Set(dispatchers).size, 1);
  assert.equal(http.agentStats.created, 1);
  assert.ok(http.agentStats.reused >= 5);

  blockNext = true;
  const rotated = await run();
  assert.equal(rotated.attempts, 2);
  assert.equal(made.length, 2, "block → exactly one new agent");
  assert.equal(newUrlCalls, 2);
  await run();
  await run();
  assert.equal(made.length, 2, "the new session is then reused too");
  assert.equal(typeof rotated.proxySetupMs, "number");

  http.setAgentFactoryForTests(null);
  http.setLiveClientFactoryForTests(null);
  http.resetSessionsForTests();
});

test("proxied requests do not retry or sleep in place; a failure rotates immediately", async () => {
  process.env.YT_PROXY_URL = "http://a.example:1";
  proxy.resetProxyProvider();
  http.resetSessionsForTests();
  http.setAgentFactoryForTests((uri) => ({ uri, close: async () => {} }));
  http.setLiveClientFactoryForTests(null); // real liveClient, but it must fail without touching the network
  const t0 = Date.now();
  const err = await rejection(http.withYouTube(async (c) => c.request({ method: "GET", url: "http://127.0.0.1:1/" })));
  assert.ok(err);
  // 5 sessions x (fast connect failure) with no 400ms+ backoff and no 200-500ms rotation sleeps
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  http.setAgentFactoryForTests(null);
  http.resetSessionsForTests();
});
