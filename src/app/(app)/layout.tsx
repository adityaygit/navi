import type { CSSProperties } from "react";
import { requireCtx, getProfile } from "@/server/context";
import { Nav } from "@/components/nav";
import { QuickCapture } from "@/components/quick-capture";
import { LiveRefresh } from "@/components/live-refresh";
import { BudgetBanner } from "@/components/budget-banner";
import { getBudgetStatus } from "@/server/ai/budget";
import { naviColorVars } from "@/lib/navi-colors";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [profile, inbox, approvals, budget] = await Promise.all([
    getProfile(ctx),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    getBudgetStatus().catch(() => null),
  ]);
  const naviVars = naviColorVars((profile.preferences as Record<string, unknown> | null)?.navi_color) as CSSProperties;
  return (
    <div className="relative z-[1] flex min-h-dvh flex-col" style={naviVars}>
      <Nav counts={{ inbox: inbox.count ?? 0, approvals: approvals.count ?? 0 }} />
      {budget && (budget.warn || budget.exceeded) && <BudgetBanner spent={budget.spentUsd} cap={budget.capUsd} exceeded={budget.exceeded} />}
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-44 pt-4 safe-top md:px-8 md:pb-16 md:pt-8">{children}</main>
      <QuickCapture userId={ctx.userId} />
      <LiveRefresh adoptTimezone={profile.timezone === "UTC" && profile.onboarding_status === "not_started"} />
    </div>
  );
}
