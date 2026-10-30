import { describe, expect, it } from "vitest";
import { localPushAllowed, pushEndpointAllowed } from "@/lib/push-endpoint";

describe("push subscription endpoints (the server POSTs to these)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://web.push.apple.com/QGx1Y2t5",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts the real push service %s", (url) => {
    expect(pushEndpointAllowed(url, false)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://fcm.googleapis.com:8443/fcm/send/abc", // odd port
    "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com.attacker.net/x",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/admin",
    "https://example.com/push",
    "http://127.0.0.1:54321/rest/v1/",
    "https://localhost/x",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %s in production", (url) => {
    expect(pushEndpointAllowed(url, false)).toBe(false);
  });

  it("allows local test endpoints only outside production or when a test opts in", () => {
    expect(pushEndpointAllowed("https://127.0.0.1:4433/ok", true)).toBe(true);
    expect(localPushAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(localPushAllowed({ NODE_ENV: "production", NAVI_ALLOW_LOCAL_PUSH: "true" })).toBe(true);
    expect(localPushAllowed({ NODE_ENV: "test" })).toBe(true);
    // Even then, only loopback hosts.
    expect(pushEndpointAllowed("https://192.168.1.10/ok", true)).toBe(false);
  });
});
