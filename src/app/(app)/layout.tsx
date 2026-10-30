import { requireCtx, getProfile } from "@/server/context";
import { Nav } from "@/components/nav";
import { QuickCapture } from "@/components/quick-capture";
import { LiveRefresh } from "@/components/live-refresh";
import { BudgetBanner } from "@/components/budget-banner";
import { getBudgetStatus } from "@/server/ai/budget";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [profile, inbox, approvals, budget] = await Promise.all([
    getProfile(ctx),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    getBudgetStatus().catch(() => null),
  ]);
  return (
    <div className="flex min-h-dvh">
      <Nav counts={{ inbox: inbox.count ?? 0, approvals: approvals.count ?? 0 }} />
      <div className="flex min-w-0 flex-1 flex-col">
        {budget && (budget.warn || budget.exceeded) && <BudgetBanner spent={budget.spentUsd} cap={budget.capUsd} exceeded={budget.exceeded} />}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-36 pt-4 safe-top md:px-8 md:pb-16 md:pt-8">{children}</main>
      </div>
      <QuickCapture userId={ctx.userId} />
      <LiveRefresh adoptTimezone={profile.timezone === "UTC" && profile.onboarding_status === "not_started"} />
    </div>
  );
}
