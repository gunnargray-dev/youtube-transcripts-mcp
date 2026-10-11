/**
 * HTTP layer for YouTube requests: timeouts, transient-error retries, proxy
 * sessions with rotation on block, and the offline fixture mode.
 *
 * Everything that talks to YouTube runs inside `withYouTube(fn)`. `fn` receives
 * an `HttpClient` bound to one proxy session (= one exit IP), because signed
 * caption URLs returned by the player API are only valid from the IP that
 * requested them. If `fn` fails with a block-type error and a proxy is
 * configured, the session is discarded and `fn` is re-run on a fresh session.
 */
import { ProxyAgent, fetch, type Dispatcher } from "undici";
import { fixtureRequest } from "./fixtures.js";
import { type ProxyProvider, getProxyProvider, newSessionId } from "./proxy.js";
import { ErrorCodes, YouTubeError, errorMessage, sleep } from "./util.js";

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  /** JSON string for POST requests. */
  body?: string;
}

export interface HttpResponse {
  status: number;
  text: string;
  url: string;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
  /** Proxy session id, or null when connecting directly / using fixtures. */
  readonly sessionId: string | null;
}

/** Per-request timeout. Short on purpose: a stalled proxy exit is cheaper to rotate than to wait for. */
const TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS ?? 8_000);
/** In-client retries. Only used for direct connections; with a proxy a failure rotates the session instead. */
const MAX_RETRIES = Number(process.env.HTTP_MAX_RETRIES ?? 2);
/** A successful operation slower than this retires its session so the next call gets a fresh exit IP. */
const SLOW_SESSION_MS = Number(process.env.YT_SLOW_SESSION_MS ?? 6_000);
/** Keep proxy tunnels open between tool calls (undici's default is 4 s, which forces a new CONNECT + TLS per call). */
const KEEP_ALIVE_MS = Number(process.env.YT_KEEP_ALIVE_MS ?? 60_000);
/** Total proxy sessions tried for one operation before giving up. */
const PROXY_ATTEMPTS = Math.max(1, Number(process.env.YT_PROXY_ATTEMPTS ?? 5));

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------------------------------------------------------------------------
// Proxy agents (one per session, reused while the session is healthy)
// ---------------------------------------------------------------------------

const agents = new Map<string, Dispatcher>();
let stickySession: string | null = null;

/** Counters for tests/diagnostics: how many agents and proxy URLs were created. */
export const agentStats = { created: 0, reused: 0 };

type AgentFactory = (uri: string) => Dispatcher;
const defaultAgentFactory: AgentFactory = (uri) =>
  new ProxyAgent({
    uri,
    connectTimeout: TIMEOUT_MS,
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_MS,
    keepAliveMaxTimeout: KEEP_ALIVE_MS * 10,
  });
let makeAgent: AgentFactory = defaultAgentFactory;

/** Test hook: replace the ProxyAgent constructor. Pass null to restore. */
export function setAgentFactoryForTests(factory: AgentFactory | null): void {
  makeAgent = factory ?? defaultAgentFactory;
}

/** Test hook: drop every cached agent and the sticky session. */
export function resetSessionsForTests(): void {
  for (const a of agents.values()) a.close().catch(() => {});
  agents.clear();
  stickySession = null;
  agentStats.created = 0;
  agentStats.reused = 0;
}

async function agentFor(provider: ProxyProvider, sessionId: string): Promise<Dispatcher | undefined> {
  const existing = agents.get(sessionId);
  if (existing) {
    agentStats.reused++;
    return existing;
  }
  const url = await provider.newUrl(sessionId);
  if (!url) return undefined;
  const agent = makeAgent(url);
  agentStats.created++;
  agents.set(sessionId, agent);
  while (agents.size > 16) {
    const [oldId, old] = agents.entries().next().value!;
    agents.delete(oldId);
    old.close().catch(() => {});
  }
  return agent;
}

function retireSession(sessionId: string): void {
  const agent = agents.get(sessionId);
  agents.delete(sessionId);
  agent?.close().catch(() => {});
  if (stickySession === sessionId) stickySession = null;
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

const isRetryableStatus = (s: number) => s === 408 || s === 425 || s >= 500;

function liveClient(dispatcher: Dispatcher | undefined, sessionId: string | null): HttpClient {
  return {
    sessionId,
    async request(req) {
      let lastErr: unknown;
      // Proxied sessions never retry in place: a slow/failed exit IP is rotated by withYouTube instead.
      const retries = sessionId ? 0 : MAX_RETRIES;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(400 * 2 ** (attempt - 1) + Math.random() * 250);
        try {
          const res = await fetch(req.url, {
            method: req.method,
            headers: {
              ...DEFAULT_HEADERS,
              ...(req.body ? { "Content-Type": "application/json" } : {}),
              ...req.headers,
            },
            body: req.body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
            ...(dispatcher ? { dispatcher } : {}),
          });
          const text = await res.text();
          if (res.status === 429) {
            throw new YouTubeError(
              ErrorCodes.REQUEST_BLOCKED,
              "YouTube is rate-limiting/blocking requests from this IP (HTTP 429).",
              { httpStatus: 429 },
            );
          }
          if (isRetryableStatus(res.status)) {
            lastErr = new YouTubeError(ErrorCodes.UPSTREAM_ERROR, `YouTube responded ${res.status}`, { httpStatus: res.status });
            continue;
          }
          return { status: res.status, text, url: res.url || req.url };
        } catch (err) {
          if (err instanceof YouTubeError && !err.retryable) throw err;
          if (err instanceof YouTubeError && err.code === ErrorCodes.REQUEST_BLOCKED) throw err;
          const name = (err as { name?: string })?.name;
          lastErr =
            err instanceof YouTubeError
              ? err
              : new YouTubeError(
                  ErrorCodes.UPSTREAM_ERROR,
                  name === "TimeoutError" || name === "AbortError"
                    ? `Request to YouTube timed out after ${TIMEOUT_MS} ms`
                    : `Network error contacting YouTube: ${errorMessage((err as { cause?: unknown })?.cause ?? err)}`,
                  { network: true },
                );
        }
      }
      throw lastErr;
    },
  };
}

type ClientFactory = (dispatcher: Dispatcher | undefined, sessionId: string | null) => HttpClient;
let makeLiveClient: ClientFactory = liveClient;

/** Test hook: replace the network client (e.g. to simulate blocks per proxy session). Pass null to restore. */
export function setLiveClientFactoryForTests(factory: ClientFactory | null): void {
  makeLiveClient = factory ?? liveClient;
}

function fixtureClient(dir: string): HttpClient {
  return {
    sessionId: null,
    async request(req) {
      const res = await fixtureRequest(dir, req);
      if (res.status === 429) {
        throw new YouTubeError(
          ErrorCodes.REQUEST_BLOCKED,
          "YouTube is rate-limiting/blocking requests from this IP (HTTP 429).",
          { httpStatus: 429 },
        );
      }
      if (isRetryableStatus(res.status)) {
        throw new YouTubeError(ErrorCodes.UPSTREAM_ERROR, `YouTube responded ${res.status}`, { httpStatus: res.status });
      }
      return res;
    },
  };
}

// ---------------------------------------------------------------------------
// Session orchestration
// ---------------------------------------------------------------------------

export interface YouTubeContext {
  /** Number of proxy sessions used (1 = first try succeeded). */
  attempts: number;
  proxy: string | null;
  /** Time spent obtaining the proxy session/agent for the successful attempt (0 when cached). */
  proxySetupMs: number;
  /** Proxy session id of the successful attempt (null without a proxy). */
  sessionId: string | null;
}

/**
 * Run `fn` against YouTube. With a proxy configured, block-type failures
 * (REQUEST_BLOCKED, EMPTY_TRANSCRIPT, network/5xx) rotate to a new proxy
 * session up to `YT_PROXY_ATTEMPTS` times. Without a proxy there is nothing
 * to rotate, so the error is returned immediately with guidance.
 */
export async function withYouTube<T>(fn: (http: HttpClient, ctx: YouTubeContext) => Promise<T>): Promise<T> {
  const fixtures = process.env.YT_FIXTURES;
  if (fixtures) return fn(fixtureClient(fixtures), { attempts: 1, proxy: null, proxySetupMs: 0, sessionId: null });

  const setupStart = Date.now();
  const provider = await getProxyProvider();
  if (!provider) {
    try {
      return await fn(makeLiveClient(undefined, null), { attempts: 1, proxy: null, proxySetupMs: 0, sessionId: null });
    } catch (err) {
      if (err instanceof YouTubeError && err.code === ErrorCodes.REQUEST_BLOCKED) {
        throw new YouTubeError(
          err.code,
          `${err.message} No proxy is configured: set YT_PROXY_URL (self-hosted) or run on Apify, where Apify Proxy is used automatically.`,
          { ...err.details, proxy: null, attempts: 1 },
        );
      }
      throw err;
    }
  }

  let lastErr: YouTubeError | null = null;
  for (let attempt = 1; attempt <= PROXY_ATTEMPTS; attempt++) {
    const sessionId = (stickySession ??= newSessionId());
    let dispatcher: Dispatcher | undefined;
    const t0 = attempt === 1 ? setupStart : Date.now();
    try {
      dispatcher = await agentFor(provider, sessionId);
    } catch (err) {
      throw new YouTubeError(ErrorCodes.INTERNAL_ERROR, `Could not create proxy session: ${errorMessage(err)}`);
    }
    const proxySetupMs = Date.now() - t0;
    const t1 = Date.now();
    try {
      const out = await fn(makeLiveClient(dispatcher, sessionId), {
        attempts: attempt,
        proxy: provider.label,
        proxySetupMs,
        sessionId,
      });
      if (Date.now() - t1 > SLOW_SESSION_MS) {
        console.error(`[proxy] session ${sessionId} was slow (${Date.now() - t1} ms); rotating for the next call`);
        retireSession(sessionId);
      }
      return out;
    } catch (err) {
      if (!(err instanceof YouTubeError) || !err.retryable) throw err;
      lastErr = err;
      retireSession(sessionId);
      console.error(`[proxy] ${err.code} on session ${sessionId} (attempt ${attempt}/${PROXY_ATTEMPTS}); rotating`);
    }
  }
  throw new YouTubeError(
    lastErr!.code,
    `${lastErr!.message} (still failing after ${PROXY_ATTEMPTS} proxy sessions via ${provider.label})`,
    { ...lastErr!.details, proxy: provider.label, attempts: PROXY_ATTEMPTS },
  );
}
