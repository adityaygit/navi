import "server-only";
import { z } from "zod";
import { getProfile, type Ctx } from "@/server/context";
import { getOrCreateConversation, listMessages, messageActions } from "@/server/ai/chat";
import { wakeBed } from "@/server/day";
import { completeOnboarding, finishTalk, restartOnboarding, saveBasics, saveWelcomeStep, skipWelcome } from "@/server/domain/welcome";
import { resumeStep } from "@/lib/onboarding";
import type { MOk } from "@/lib/mobile-api-types";
import type { MWelcome, MWelcomeCompleted, MWelcomeTalk } from "@/lib/mobile-api-welcome";
import type { Proposal } from "@/lib/types";
import { messageView, proposalView } from "./views";

// Setup on the phone (M6 step 5): the web's /welcome steps over the phone API,
// through the same functions (src/server/domain/welcome.ts). Registered by router.ts.

type Handler = (ctx: Ctx, req: { params: Record<string, string>; body: unknown; query: URLSearchParams }) => Promise<unknown>;
type Register = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, handler: Handler) => void;

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export async function welcomeView(ctx: Ctx): Promise<MWelcome> {
  const profile = await getProfile(ctx);
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const wb = wakeBed(profile);
  const { count } = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("batch", "onboarding").eq("status", "pending");
  return {
    step: resumeStep(profile.onboarding_status, prefs.onboarding_step),
    status: profile.onboarding_status,
    firstName: profile.display_name?.trim().split(/\s+/)[0] || null,
    basics: { name: profile.display_name ?? "", timezone: profile.timezone, wake: wb?.wake ?? "07:00", bed: wb?.bed ?? "23:00" },
    picked: count ?? 0,
    checkIn: { morning: hhmm(profile.morning_briefing_time) ?? wb?.wake ?? "06:00", evening: hhmm(profile.evening_review_time) ?? "21:00", quietFrom: hhmm(profile.quiet_hours_start) },
  };
}

async function talkView(ctx: Ctx): Promise<MWelcomeTalk> {
  const id = await getOrCreateConversation(ctx, "onboarding");
  const [messages, props] = await Promise.all([
    listMessages(ctx, id),
    ctx.db.from("proposals").select("*").eq("batch", "onboarding").in("status", ["pending", "deferred"]).order("created_at"),
  ]);
  const { actions, undone } = await messageActions(ctx, messages);
  return {
    id,
    title: null,
    messages: messages.map((m) => messageView(m, actions)),
    actions,
    undone,
    proposals: ((props.data ?? []) as Proposal[]).map((p) => proposalView(p)),
  };
}

const ok: MOk = { ok: true };

export function registerWelcomeRoutes(route: Register): void {
  route("GET", "welcome", (ctx) => welcomeView(ctx));
  route("GET", "welcome/talk", (ctx) => talkView(ctx));
  route("POST", "welcome/step", async (ctx, { body }) => {
    await saveWelcomeStep(ctx, z.object({ step: z.string() }).parse(body).step);
    return welcomeView(ctx);
  });
  route("POST", "welcome/basics", async (ctx, { body }) => {
    const b = z.object({ name: z.string(), timezone: z.string(), wake: z.string(), bed: z.string() }).parse(body);
    await saveBasics(ctx, { display_name: b.name, timezone: b.timezone, wake: b.wake, bed: b.bed });
    return welcomeView(ctx);
  });
  route("POST", "welcome/talk-done", async (ctx) => {
    await finishTalk(ctx);
    return welcomeView(ctx);
  });
  route("POST", "welcome/restart", async (ctx) => {
    await restartOnboarding(ctx);
    await saveWelcomeStep(ctx, "talk");
    return welcomeView(ctx);
  });
  route("POST", "welcome/skip", async (ctx, { body }) => {
    await skipWelcome(ctx, z.object({ step: z.string() }).parse(body ?? {}).step);
    return ok;
  });
  route("POST", "welcome/complete", async (ctx, { body }): Promise<MWelcomeCompleted> => {
    const { acceptIds } = z.object({ acceptIds: z.array(z.string().uuid()).max(500) }).parse(body);
    const r = await completeOnboarding(ctx, acceptIds);
    return { accepted: r.accepted, failed: r.failed.map((f) => ({ id: f.id, error: f.error })), plannedBlocks: r.plannedBlocks };
  });
}
