/**
 * Proxy selection for outgoing YouTube requests.
 *
 * YouTube blocks most cloud/datacenter IPs that hit it directly. On the Apify
 * platform (`APIFY_IS_AT_HOME`) requests are therefore routed through Apify
 * Proxy (datacenter by default) via `Actor.createProxyConfiguration()`; each
 * "session" maps to a sticky proxy IP and is replaced when YouTube blocks it.
 *
 * Self-hosters can set `YT_PROXY_URL` (one or more comma-separated
 * http://user:pass@host:port URLs) to use their own proxies.
 */
import { initApify, isAtHome } from "./billing.js";

export interface ProxyProvider {
  /** Human-readable label for logs/metadata (never contains credentials). */
  readonly label: string;
  /** Proxy URL for the given session id (same id → same exit IP where supported). */
  newUrl(sessionId: string): Promise<string | undefined>;
}

let providerPromise: Promise<ProxyProvider | null> | null = null;

function staticProvider(urls: string[]): ProxyProvider {
  let next = 0;
  const bySession = new Map<string, string>();
  return {
    label: `custom (${urls.length} url${urls.length > 1 ? "s" : ""})`,
    async newUrl(sessionId) {
      let url = bySession.get(sessionId);
      if (!url) {
        url = urls[next++ % urls.length]!;
        bySession.set(sessionId, url);
        if (bySession.size > 1000) bySession.delete(bySession.keys().next().value!);
      }
      return url;
    },
  };
}

async function apifyProvider(): Promise<ProxyProvider | null> {
  const actor = await initApify();
  if (!actor) return null;
  const groups = (process.env.YT_PROXY_GROUPS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const countryCode = process.env.YT_PROXY_COUNTRY?.trim() || undefined;
  try {
    // No groups = Apify's automatic datacenter proxy pool.
    const config = await actor.createProxyConfiguration({
      ...(groups.length ? { groups } : {}),
      ...(countryCode ? { countryCode } : {}),
    });
    if (!config) {
      console.error("[proxy] Apify Proxy is not available for this account; requesting YouTube directly");
      return null;
    }
    return {
      label: `apify:${groups.length ? groups.join("+") : "datacenter"}${countryCode ? `:${countryCode}` : ""}`,
      newUrl: (sessionId) => config.newUrl(sessionId),
    };
  } catch (err) {
    console.error(`[proxy] failed to create Apify proxy configuration; requesting YouTube directly: ${String(err)}`);
    return null;
  }
}

async function resolveProvider(): Promise<ProxyProvider | null> {
  if (process.env.YT_FIXTURES) return null;
  if ((process.env.YT_PROXY ?? "").toLowerCase() === "off") return null;
  const custom = (process.env.YT_PROXY_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (custom.length) return staticProvider(custom);
  if (isAtHome()) return apifyProvider();
  return null;
}

/** Resolve (once) the proxy provider for this process, or null for direct connections. */
export function getProxyProvider(): Promise<ProxyProvider | null> {
  providerPromise ??= resolveProvider();
  return providerPromise;
}

/** Test hook: forget the cached provider so env changes take effect. */
export function resetProxyProvider(): void {
  providerPromise = null;
}

/** Apify session ids must match [\w._~]{1,50}. */
export function newSessionId(): string {
  return `yt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
