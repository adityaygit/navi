import { describe, expect, it } from "vitest";
import { deviceLabel, pushServiceLabel } from "@/lib/push-diagnostics";

describe("push diagnostics labels", () => {
  it.each([
    ["https://web.push.apple.com/QGx1Y2t5", "Apple"],
    ["https://fcm.googleapis.com/fcm/send/abc", "Google"],
    ["https://updates.push.services.mozilla.com/wpush/v2/x", "Mozilla"],
    ["https://wns2-par02p.notify.windows.com/w/?token=abc", "Microsoft"],
    ["https://fcm.googleapis.com.evil.com/x", "Unknown push service"],
    ["not a url", "Unknown push service"],
  ])("names the push service of %s", (endpoint, label) => {
    expect(pushServiceLabel(endpoint)).toBe(label);
  });

  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Chrome on Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox on Linux"],
    [null, "Unknown device"],
  ])("labels the device for %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
