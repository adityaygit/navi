import { requireCtx, getProfile } from "@/server/context";
import { getOrCreateConversation, listMessages } from "@/server/ai/chat";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { Chat } from "@/components/chat";
import { OnboardingReview } from "./review";
import type { Proposal } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { Pebble } from "@/components/pebble";
import { skipOnboardingAction, restartOnboardingAction } from "../actions";

export const metadata = { title: "Set up · Navi" };

export default async function OnboardingPage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const conversationId = await getOrCreateConversation(ctx, "onboarding");
  const [messages, proposalsRes] = await Promise.all([
    listMessages(ctx, conversationId),
    ctx.db.from("proposals").select("*").eq("batch", "onboarding").in("status", ["pending", "deferred"]).order("created_at"),
  ]);
  const proposals = (proposalsRes.data ?? []) as Proposal[];
  const ai = aiAvailability();
  const voice = voiceAvailability();
  const reviewing = profile.onboarding_status === "reviewing" && proposals.length > 0;
  const finished = profile.onboarding_status === "completed" || profile.onboarding_status === "skipped";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-4">
        <span className="mt-1 hidden md:block"><Pebble size={52} mood={reviewing ? "ask" : "idle"} float /></span>
        <div className="flex min-w-[240px] flex-1 flex-col gap-2">
          <h1 className="h1">{reviewing ? "Review your setup" : "Let's set up Navi"}</h1>
          <p className="muted max-w-2xl text-[15px] leading-relaxed">
            {reviewing
              ? "Navi drafted your operating system from your conversation. Only what you approve becomes active; anything you leave unchecked stays in your inbox."
              : "Tell Navi about your life by typing or talking. It will propose your areas, projects, goals, routines, commitments and a first plan for you to approve."}
          </p>
        </div>
        <div className="flex gap-2 md:ml-auto">
          {finished ? (
            <ActionButton className="btn btn-sm" action={restartOnboardingAction}>Continue setup conversation</ActionButton>
          ) : (
            <ActionButton className="btn btn-ghost btn-sm" confirm="Skip setup? You can come back to it from Settings." action={skipOnboardingAction}>
              Skip for now
            </ActionButton>
          )}
        </div>
      </header>
      {reviewing ? (
        <OnboardingReview proposals={proposals} zone={profile.timezone} />
      ) : (
        <div className="surf flex h-[70dvh] flex-col p-4 md:p-6">
          <Chat kind="onboarding" initialMessages={messages} ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }} voice={voice} placeholder="Tell Navi about your week…" />
        </div>
      )}
      {finished && <p className="muted text-sm">Setup is done. Anything new you tell Navi here gets proposed to your inbox.</p>}
    </div>
  );
}
