import { requireCtx, getProfile } from "@/server/context";
import { getOrCreateConversation, listMessages } from "@/server/ai/chat";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { Chat } from "@/components/chat";
import { OnboardingReview } from "./review";
import type { Proposal } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
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
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-2">
        <div>
          <h1 className="h1">{reviewing ? "Review your setup" : "Let's set up Navi"}</h1>
          <p className="muted text-sm">
            {reviewing
              ? "Navi drafted your operating system from your conversation. Only what you approve becomes active; anything you leave unchecked stays in your inbox."
              : "Tell Navi about your life by typing or talking. It will propose your areas, projects, goals, routines, commitments and a first plan for you to approve."}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {finished ? (
            <ActionButton className="btn btn-sm" action={() => restartOnboardingAction()}>Continue setup conversation</ActionButton>
          ) : (
            <ActionButton className="btn btn-ghost btn-sm" confirm="Skip setup? You can come back to it from Settings." action={async () => { const r = await skipOnboardingAction(); return r; }}>
              Skip for now
            </ActionButton>
          )}
        </div>
      </header>
      {reviewing ? (
        <OnboardingReview proposals={proposals} zone={profile.timezone} />
      ) : (
        <div className="card flex h-[70dvh] flex-col">
          <Chat kind="onboarding" initialMessages={messages} ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }} voice={voice} placeholder="Tell Navi about your week…" />
        </div>
      )}
      {finished && <p className="muted text-sm">Setup is done. Anything new you tell Navi here gets proposed to your inbox.</p>}
    </div>
  );
}
