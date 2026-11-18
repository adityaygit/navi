import { beforeEach, describe, expect, it, vi } from "vitest";

// The offline queue: kept per account, sent in order once online, removed
// only when the server has it, kept (and retried) when the network fails.

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});
const nav = { onLine: true };
vi.stubGlobal("navigator", nav);
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

const sent: unknown[] = [];
let fail: Error | null = null;
vi.mock("@capacitor/app", () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("../api/client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    api: async (_path: string, init: { body: unknown }) => {
      if (fail) throw fail;
      sent.push(init.body);
      return { capture_id: "x" };
    },
  };
});

const off = await import("../data/offline");

beforeEach(() => {
  store.clear();
  sent.length = 0;
  fail = null;
  nav.onLine = true;
});

describe("offline queue", () => {
  it("keeps what's typed offline and sends it in order when back online", async () => {
    off.setOfflineOwner("me");
    nav.onLine = false;
    off.enqueueCapture("buy oat milk");
    off.enqueueCapture("call the dentist");
    expect(await off.flushQueue()).toBe(0); // still offline: nothing sent
    nav.onLine = true;
    expect(await off.flushQueue()).toBe(2);
    expect(sent.map((b) => (b as { raw_text: string }).raw_text)).toEqual(["buy oat milk", "call the dentist"]);
    expect((sent[0] as { source: string; client_id: string }).source).toBe("offline");
    expect(await off.flushQueue()).toBe(0); // gone once sent
  });

  it("keeps an item when the network fails, and each account only sends its own", async () => {
    off.setOfflineOwner("me");
    nav.onLine = false;
    off.enqueueCapture("mine");
    off.setOfflineOwner("someone else");
    off.enqueueCapture("theirs");
    nav.onLine = true;
    fail = new TypeError("network down");
    expect(await off.flushQueue()).toBe(0);
    fail = null;
    expect(await off.flushQueue()).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ raw_text: "theirs" })]);
    off.setOfflineOwner("me");
    await off.flushQueue();
    expect(sent.map((b) => (b as { raw_text: string }).raw_text)).toEqual(["theirs", "mine"]);
  });

  it("caches answers per account and clears them on sign out", () => {
    off.setOfflineOwner("me");
    off.cachePut("/api/m/day", { a: 1 });
    expect(off.cacheGet<{ a: number }>("/api/m/day")?.data).toEqual({ a: 1 });
    off.setOfflineOwner("someone else");
    expect(off.cacheGet("/api/m/day")).toBeNull();
    off.setOfflineOwner("me");
    off.clearOfflineCache();
    expect(off.cacheGet("/api/m/day")).toBeNull();
  });
});
