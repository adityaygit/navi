import "server-only";
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

// Fetches a remote document (a calendar feed) on behalf of a user without
// letting that user aim Navi's server at anything else (SSRF):
//  - every URL, including each redirect target, must pass the caller's
//    allowlist (scheme, host, port, path) before any connection is made;
//  - the host name is resolved once, every address is checked against private,
//    loopback, link-local, metadata and other reserved ranges, and the
//    connection is pinned to the checked address (no second DNS lookup, so DNS
//    rebinding can't swap in an internal address); TLS still verifies the
//    certificate for the real host name;
//  - redirects are followed by hand (at most a few), never automatically;
//  - one deadline covers DNS, connect, headers and body; the body is capped.
// Error messages never include the URL: feed URLs are credentials.

export type FeedErrorCode =
  | "invalid_url"
  | "host_not_allowed"
  | "blocked_address"
  | "dns"
  | "timeout"
  | "network"
  | "too_large"
  | "too_many_redirects"
  | "http_auth"
  | "http_not_found"
  | "http_rate_limited"
  | "http_server"
  | "http_other"
  | "not_calendar"
  | "invalid_feed"
  /** The stored credential could not be read (key changed or row damaged). */
  | "secret";

export class FeedError extends Error {
  constructor(public code: FeedErrorCode, message: string, public retryable = false, public status?: number) {
    super(message);
    this.name = "FeedError";
  }
}

// Separate lists: Node matches IPv4 addresses against IPv4-mapped IPv6 rules.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, prefix, "ipv6");
const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** IPv4 written inside IPv6 (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d, 2002:aabb:ccdd::) */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/(?:^::(?:ffff:)?|^64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const a = parseInt(sixToFour[1], 16), b = parseInt(sixToFour[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** True for any address a user-supplied URL must never reach. */
export function isBlockedAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const family = isIP(ip);
  if (!family) return true;
  const type = family === 4 ? "ipv4" : "ipv6";
  if (opts.allowLoopback && loopback.check(ip, type)) return false;
  if (family === 4) return blocked4.check(ip, "ipv4");
  if (blocked6.check(ip, "ipv6")) {
    const v4 = family === 6 ? embeddedV4(ip) : null;
    // A mapped/NAT64/6to4 address is judged by the IPv4 address inside it.
    if (v4) return isBlockedAddress(v4, opts);
    return true;
  }
  return false;
}

export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Resolved[]>;

export type TransportResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Buffer | string>; destroy: () => void };
/** Opens one HTTP(S) request to `url`, connecting only to `address`. */
export type Transport = (req: { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; signal: AbortSignal }) => Promise<TransportResponse>;

export type FetchPolicy = {
  /** Checked for the first URL and every redirect target. */
  isAllowedUrl: (url: URL) => boolean;
  /** Development only: allow http://127.0.0.1 style local test servers. */
  allowLoopback?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: Resolver;
  transport?: Transport;
  userAgent?: string;
};

const defaultResolver: Resolver = async (host) => {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

const defaultTransport: Transport = ({ url, address, family, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "http:" ? http : https;
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent: false,
        signal,
        // Pin the connection to the address that was checked. The certificate
        // is still verified against url.hostname (SNI + hostname check).
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts && opts.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        }) as never,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() }),
    );
    req.on("error", reject);
    req.end();
  });

/**
 * GETs `url` under `policy` and returns the body as text. Throws FeedError
 * (with a code and whether a retry may help) for every failure.
 */
export async function safeFetchText(input: string, policy: FetchPolicy): Promise<{ text: string; finalHost: string }> {
  const maxBytes = policy.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = policy.timeoutMs ?? 20_000;
  const maxRedirects = policy.maxRedirects ?? 3;
  const resolver = policy.resolver ?? defaultResolver;
  const transport = policy.transport ?? defaultTransport;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () => new FeedError("timeout", "The calendar server took too long to answer.", true);

  try {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new FeedError("invalid_url", "That isn't a valid link.");
    }
    for (let hop = 0; ; hop++) {
      if (!policy.isAllowedUrl(url)) throw new FeedError("host_not_allowed", "That link isn't from an allowed calendar host.");
      if (url.username || url.password) throw new FeedError("invalid_url", "Links with a user name or password aren't allowed.");
      if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new FeedError("host_not_allowed", "Links to a bare IP address aren't allowed.");

      let addresses: Resolved[];
      try {
        addresses = await resolver(url.hostname);
      } catch {
        if (controller.signal.aborted) throw timedOut();
        throw new FeedError("dns", "Couldn't find that calendar server.", true);
      }
      if (!addresses.length) throw new FeedError("dns", "Couldn't find that calendar server.", true);
      // Every address must be public: a name that also resolves inside a private network is refused.
      if (addresses.some((a) => isBlockedAddress(a.address, { allowLoopback: policy.allowLoopback }))) {
        throw new FeedError("blocked_address", "That link points to an address Navi won't connect to.");
      }
      const target = addresses[0];

      let res: TransportResponse;
      try {
        res = await transport({
          url,
          address: target.address,
          family: target.family,
          signal: controller.signal,
          headers: {
            accept: "text/calendar, text/plain;q=0.5, */*;q=0.1",
            "accept-encoding": "identity",
            "user-agent": policy.userAgent ?? "Navi-Calendar-Sync/1.0",
          },
        });
      } catch {
        if (controller.signal.aborted) throw timedOut();
        throw new FeedError("network", "Couldn't connect to the calendar server.", true);
      }

      if (res.status >= 300 && res.status < 400) {
        res.destroy();
        const location = res.headers.location;
        const loc = Array.isArray(location) ? location[0] : location;
        if (!loc) throw new FeedError("http_other", `The calendar server answered HTTP ${res.status} without a destination.`, false, res.status);
        if (hop >= maxRedirects) throw new FeedError("too_many_redirects", "The calendar link redirected too many times.");
        try {
          url = new URL(loc, url);
        } catch {
          throw new FeedError("invalid_url", "The calendar server redirected to an invalid link.");
        }
        continue;
      }
      if (res.status !== 200) {
        res.destroy();
        const s = res.status;
        if (s === 401 || s === 403) throw new FeedError("http_auth", "The calendar server refused this link.", false, s);
        if (s === 404 || s === 410) throw new FeedError("http_not_found", "The calendar server says this link doesn't exist.", false, s);
        if (s === 429) throw new FeedError("http_rate_limited", "The calendar server asked Navi to slow down.", true, s);
        if (s >= 500) throw new FeedError("http_server", `The calendar server had a problem (HTTP ${s}).`, true, s);
        throw new FeedError("http_other", `The calendar server answered HTTP ${s}.`, false, s);
      }

      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        throw new FeedError("too_large", "The calendar is larger than Navi accepts.");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          size += buf.length;
          if (size > maxBytes) {
            res.destroy();
            throw new FeedError("too_large", "The calendar is larger than Navi accepts.");
          }
          chunks.push(buf);
        }
      } catch (err) {
        if (err instanceof FeedError) throw err;
        if (controller.signal.aborted) throw timedOut();
        throw new FeedError("network", "The connection dropped while reading the calendar.", true);
      }
      if (controller.signal.aborted) throw timedOut();
      return { text: Buffer.concat(chunks).toString("utf8"), finalHost: url.hostname };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Retries retryable FeedErrors with exponential backoff (e.g. 1s, 3s). */
export async function withRetries<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof FeedError) || !err.retryable || i >= attempts) throw err;
      await sleep(baseMs * 3 ** (i - 1));
    }
  }
}
