import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admin, resetUser, userClient } from "./helpers";
import { sendToSubscriptions } from "@/server/jobs/notify";

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
      res.statusCode = req.url === "/gone" ? 410 : 201;
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
});
