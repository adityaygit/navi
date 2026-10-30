import { schedules } from "@trigger.dev/sdk";

// Every 10 minutes: ask the deployed app to run its idempotent scheduler tick
// (briefings at local 06:00/21:00, weekly review, deadline reminders, push
// delivery). Keeping the logic in the app means one code path for every runner.
// Env needed in Trigger.dev: NAVI_APP_URL, CRON_SECRET.
export const naviTick = schedules.task({
  id: "navi-tick",
  cron: "*/10 * * * *",
  maxDuration: 300,
  run: async () => {
    const url = process.env.NAVI_APP_URL;
    const secret = process.env.CRON_SECRET;
    if (!url || !secret) throw new Error("NAVI_APP_URL and CRON_SECRET must be set in the Trigger.dev environment");
    const res = await fetch(`${url.replace(/\/$/, "")}/api/cron/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Tick failed: ${res.status} ${body.slice(0, 500)}`);
    return JSON.parse(body);
  },
});
