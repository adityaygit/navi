import { schedules } from "@trigger.dev/sdk";

// Every 30 minutes: ask the deployed app to refresh calendar-feed connections
// that are due. Each connection is refreshed every 6 hours (and retried with
// backoff after a failure); the app decides which ones are due, so calling
// more often never syncs a feed more often. Retries with exponential backoff
// come from trigger.config.ts. Env needed in Trigger.dev: NAVI_APP_URL, CRON_SECRET.
export const naviIntegrationsSync = schedules.task({
  id: "navi-integrations-sync",
  cron: "7,37 * * * *",
  maxDuration: 300,
  run: async () => {
    const url = process.env.NAVI_APP_URL;
    const secret = process.env.CRON_SECRET;
    if (!url || !secret) throw new Error("NAVI_APP_URL and CRON_SECRET must be set in the Trigger.dev environment");
    const res = await fetch(`${url.replace(/\/$/, "")}/api/cron/integrations`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Integrations sync failed: ${res.status} ${body.slice(0, 500)}`);
    return JSON.parse(body);
  },
});
