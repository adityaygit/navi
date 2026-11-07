import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import { getOrCreateConversation, listMessages, messageActions } from "@/server/ai/chat";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { resumeStep } from "@/lib/onboarding";
import { naviColorVars } from "@/lib/navi-colors";
import type { Proposal } from "@/lib/types";
import { awakeSpan, dayFrom, loadSources, wakeBed, zoneHelpers } from "@/server/day";
import { myDayHeadline } from "@/lib/sentences";
import { spaceColor } from "@/lib/space-color";
import { formatTime } from "@/lib/time";
import { publicEnv } from "@/lib/env";
import { Welcome, type PlanRow } from "./welcome";

export const metadata = { title: "Set up · Navi" };

/**
 * Setup, full screen and outside the app shell: Hello · Basics · Talk ·
 * Review · Stay in touch · First plan. The step is saved on the account
 * (profiles.preferences.onboarding_step), so it resumes on any device.
 */
export default async function WelcomePage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const step = resumeStep(profile.onboarding_status, prefs.onboarding_step);
  if (!step) redirect("/");

  const zone = profile.timezone;
  const wb = wakeBed(profile);
  const firstName = profile.display_name?.trim().split(/\s+/)[0] ?? null;
  const base = {
    step,
    firstName,
    naviVars: naviColorVars(prefs.navi_color) as CSSProperties,
  };

  if (step === "talk" || step === "review") {
    const conversationId = await getOrCreateConversation(ctx, "onboarding");
    const [messages, proposalsRes] = await Promise.all([
      listMessages(ctx, conversationId),
      ctx.db.from("proposals").select("*").eq("batch", "onboarding").in("status", ["pending", "deferred"]).order("created_at"),
    ]);
    const { actions, undone } = await messageActions(ctx, messages);
    const ai = aiAvailability();
    return (
      <Welcome
        {...base}
        zone={zone}
        talk={{
          messages,
          actions,
          undone,
          proposals: (proposalsRes.data ?? []) as Proposal[],
          ai: ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason },
          voice: voiceAvailability(),
        }}
      />
    );
  }

  if (step === "plan") {
    const now = DateTime.now().setZone(zone);
    const today = now.toISODate()!;
    const src = await loadSources(ctx, today, today);
    const day = dayFrom(src, today);
    const z = zoneHelpers(zone);
    const headline = myDayHeadline(day.items.map((i) => ({ start: i.startMs, end: i.endMs })), awakeSpan(profile, today, zone), z.fmtHour, z.minuteOfDay);
    const nowMs = now.toMillis();
    const rows: PlanRow[] = [];
    let nowPlaced = false;
    for (const i of day.items) {
      if (!nowPlaced && i.startMs > nowMs) {
        const next = i;
        rows.push({ kind: "now", time: now.toFormat("h:mm"), label: `Now — free until ${formatTime(next.start!, zone)}` });
        nowPlaced = true;
      }
      const sp = i.spaceId ? src.spaces.get(i.spaceId) : null;
      rows.push({
        kind: "item",
        time: formatTime(i.start!, zone).replace(/ [AP]M$/, ""),
        title: i.title,
        sub: i.kind === "block" ? `${Math.round((i.endMs - i.startMs) / 60000)} min · placed by Navi` : `Until ${formatTime(i.end!, zone)}`,
        color: sp ? spaceColor(sp) : i.kind === "block" ? "#A7EBC0" : "#6E6E77",
        style: i.kind === "event" || i.fixed ? "fixed" : i.kind === "routine" ? "routine" : "flex",
        past: i.endMs < nowMs,
        placed: i.kind === "block",
      });
    }
    return <Welcome {...base} zone={zone} plan={{ headline, rows }} />;
  }

  return (
    <Welcome
      {...base}
      zone={zone}
      basics={{
        name: profile.display_name ?? "",
        timezone: profile.timezone,
        wake: wb?.wake ?? "07:00",
        bed: wb?.bed ?? "23:00",
      }}
      notify={{ wake: wb?.wake ?? profile.morning_briefing_time.slice(0, 5), bed: wb?.bed ?? null, evening: profile.evening_review_time.slice(0, 5), pushConfigured: Boolean(publicEnv.vapidPublicKey) }}
    />
  );
}
