import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admin, resetUser, userClient } from "./helpers";
import { dispatchDue, sendToSubscriptions } from "@/server/jobs/notify";
import type { Profile } from "@/lib/types";

// End-to-end check of the push sender without a real push service: a local
// HTTPS endpoint stands in for the browser's push service, and the test
// decrypts what arrives with the subscription's private key, exactly as a
// phone would. TLS verification is relaxed only inside this test process,
// for the self-signed local certificate.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require("http_ece") as { decrypt: (buf: Buffer, params: Record<string, unknown>) => Buffer };

let server: Server;
let port = 0;
let dir = "";
const received: { path: string; headers: Record<string, unknown>; body: Buffer }[] = [];
let userId = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navi-push-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-days", "1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
  server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url === "/gone" ? 410 : req.url === "/down" ? 503 : 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  ({ userId } = await userClient("bob@navi.test"));
  await resetUser(userId);
});

afterAll(async () => {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("web push delivery", () => {
  it("encrypts the notification for the device, signs it with VAPID, and forgets revoked devices", async () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const authSecret = randomBytes(16);
    const a = admin();
    const b64u = (b: Buffer) => b.toString("base64url");
    const { error } = await a.from("push_subscriptions").insert([
      { user_id: userId, endpoint: `https://127.0.0.1:${port}/ok`, p256dh: b64u(device.getPublicKey()), auth: b64u(authSecret) },
      { user_id: userId, endpoint: `https://127.0.0.1:${port}/gone`, p256dh: b64u(device.getPublicKey()), auth: b64u(authSecret) },
    ]);
    expect(error).toBeNull();

    const payload = { title: "Morning briefing", body: "3 blocks planned", url: "/", tag: "morning:2026-10-30" };
    const r = await sendToSubscriptions(a, userId, payload);
    expect(r).toMatchObject({ sent: 1, failed: 1, none: false });

    const ok = received.find((x) => x.path === "/ok")!;
    expect(String(ok.headers["authorization"])).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(ok.headers["content-encoding"]).toBe("aes128gcm");
    expect(ok.headers["ttl"]).toBe(String(60 * 60 * 6));
    const plain = ece.decrypt(ok.body, { version: "aes128gcm", privateKey: device, authSecret: b64u(authSecret) });
    expect(JSON.parse(plain.toString("utf8"))).toEqual(payload);

    const { data: left } = await a.from("push_subscriptions").select("endpoint,last_success_at").eq("user_id", userId);
    expect(left).toHaveLength(1);
    expect(left![0].endpoint).toMatch(/\/ok$/);
    expect(left![0].last_success_at).not.toBeNull();
    await a.from("push_subscriptions").delete().eq("user_id", userId);
  });

  it("never sends to an endpoint that isn't a push service, and keeps no provider error text", async () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const a = admin();
    const keys = { p256dh: device.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
    // E.g. a row saved before endpoints were checked, pointing into the server's network.
    await a.from("push_subscriptions").insert({ user_id: userId, endpoint: "https://169.254.169.254/latest/meta-data/", ...keys });
    await a.from("push_subscriptions").insert({ user_id: userId, endpoint: `https://127.0.0.1:${port}/down`, ...keys });
    const before = received.length;
    const r = await sendToSubscriptions(a, userId, { title: "t", body: "b", url: "/", tag: "ssrf" });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect(received.length - before).toBe(1); // only the local test service was contacted
    const { data: left } = await a.from("push_subscriptions").select("endpoint,last_error").eq("user_id", userId);
    expect(left).toEqual([{ endpoint: `https://127.0.0.1:${port}/down`, last_error: "push service answered HTTP 503" }]);
    await a.from("push_subscriptions").delete().eq("user_id", userId);
  });

  it("sends a due notification once even when two scheduler runs overlap", async () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const a = admin();
    await a.from("push_subscriptions").insert({ user_id: userId, endpoint: `https://127.0.0.1:${port}/ok`, p256dh: device.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") });
    await a.from("profiles").update({ quiet_hours_start: null, quiet_hours_end: null }).eq("id", userId);
    const { data: n } = await a.from("notifications").insert({ user_id: userId, kind: "deadline", title: "Due soon", body: "Essay due 5 PM", dedupe_key: `overlap:${Date.now()}` }).select("id").single();
    const { data: profile } = await a.from("profiles").select("*").eq("id", userId).single();

    const before = received.length;
    await Promise.all([dispatchDue(a, profile as Profile), dispatchDue(a, profile as Profile)]);
    expect(received.length - before).toBe(1);
    const { data: row } = await a.from("notifications").select("status,attempts").eq("id", n!.id).single();
    expect(row).toEqual({ status: "sent", attempts: 1 });
    await a.from("push_subscriptions").delete().eq("user_id", userId);
  });

  it("retries a failed delivery later, then gives up after three attempts", async () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const a = admin();
    await a.from("push_subscriptions").insert({ user_id: userId, endpoint: `https://127.0.0.1:${port}/down`, p256dh: device.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") });
    const { data: n } = await a.from("notifications").insert({ user_id: userId, kind: "deadline", title: "Due soon", body: "Essay due 5 PM", dedupe_key: `retry:${Date.now()}` }).select("id").single();
    const { data: profile } = await a.from("profiles").select("*").eq("id", userId).single();
    const row = async () => (await a.from("notifications").select("status,attempts,deliver_after").eq("id", n!.id).single()).data!;

    await dispatchDue(a, profile as Profile);
    const first = await row();
    expect(first).toMatchObject({ status: "queued", attempts: 1 });
    expect(Date.parse(first.deliver_after) - Date.now()).toBeGreaterThan(4 * 60_000);
    // Not retried before its time.
    await dispatchDue(a, profile as Profile);
    expect((await row()).attempts).toBe(1);

    for (const attempts of [2, 3]) {
      await a.from("notifications").update({ deliver_after: new Date(Date.now() - 1000).toISOString() }).eq("id", n!.id);
      await dispatchDue(a, profile as Profile);
      expect(await row()).toMatchObject({ attempts, status: attempts < 3 ? "queued" : "failed" });
    }
    await a.from("push_subscriptions").delete().eq("user_id", userId);
  });
});
