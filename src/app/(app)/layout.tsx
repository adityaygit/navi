import type { CSSProperties } from "react";
import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireCtx, getProfile } from "@/server/context";
import { QuickCapture } from "@/components/quick-capture";
import { LiveRefresh } from "@/components/live-refresh";
import { BudgetBanner } from "@/components/budget-banner";
import { Sidebar, type SpaceLink } from "@/components/shell/sidebar";
import { NaviPanel } from "@/components/shell/navi-panel";
import { PanelProvider, PANEL_COOKIE, NAV_COOKIE } from "@/components/shell/panel-context";
import { CommandPalette } from "@/components/shell/command-palette";
import { getBudgetStatus } from "@/server/ai/budget";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { listConversations, listMessages, messageActions } from "@/server/ai/chat";
import { naviColorVars } from "@/lib/navi-colors";
import { needsOnboarding, onboardingAllowed } from "@/lib/onboarding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  // One gate for every app page (not just Home): unfinished setup goes to /welcome.
  const path = (await headers()).get("x-pathname") ?? "/";
  if (needsOnboarding(profile.onboarding_status) && !onboardingAllowed(path)) redirect("/welcome");

  const jar = await cookies();
  const nowIso = new Date().toISOString();
  const [inbox, approvals, budget, spacesRes, openTasksRes, focusRes, chats] = await Promise.all([
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", nowIso),
    getBudgetStatus().catch(() => null),
    ctx.db.from("workspaces").select("id,name,color").eq("status", "active").order("sort_order").order("created_at"),
    ctx.db.from("tasks").select("workspace_id").in("status", ["todo", "in_progress", "blocked"]).not("workspace_id", "is", null).is("parent_task_id", null),
    ctx.db.from("focus_sessions").select("id,started_at").is("ended_at", null).maybeSingle(),
    listConversations(ctx, 1),
  ]);
  const openBySpace = new Map<string, number>();
  for (const t of (openTasksRes.data ?? []) as { workspace_id: string }[]) openBySpace.set(t.workspace_id, (openBySpace.get(t.workspace_id) ?? 0) + 1);
  const spaces: SpaceLink[] = ((spacesRes.data ?? []) as { id: string; name: string; color: string | null }[]).map((w) => ({ ...w, open: openBySpace.get(w.id) ?? 0 }));

  // Focus: what arrived since it started waits behind the "N waiting" count.
  const focusRow = focusRes.data as { id: string; started_at: string } | null;
  let focus: { waiting: number } | null = null;
  if (focusRow) {
    const [p, n] = await Promise.all([
      ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").gte("created_at", focusRow.started_at),
      ctx.db.from("notifications").select("id", { count: "exact", head: true }).gte("created_at", focusRow.started_at),
    ]);
    focus = { waiting: (p.count ?? 0) + (n.count ?? 0) };
  }

  // The panel continues the most recent chat.
  const latest = chats[0] ?? null;
  const messages = latest ? await listMessages(ctx, latest.id, 40) : [];
  const { actions, undone } = await messageActions(ctx, messages);
  const ai = aiAvailability();

  const naviVars = naviColorVars((profile.preferences as Record<string, unknown> | null)?.navi_color) as CSSProperties;
  const panelPref = jar.get(PANEL_COOKIE)?.value === "collapsed" ? "collapsed" : "open";
  const navCollapsed = jar.get(NAV_COOKIE)?.value === "collapsed";
  const firstName = profile.display_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <PanelProvider initialPref={panelPref}>
      <div className="shell relative z-[1]" style={naviVars}>
        <Suspense fallback={<div className="hidden w-[236px] md:block" />}>
          <Sidebar name={firstName} spaces={spaces} counts={{ inbox: inbox.count ?? 0, approvals: approvals.count ?? 0 }} initialCollapsed={navCollapsed} focusLive={!!focusRow} />
        </Suspense>
        <div className="shell-main flex flex-col">
          {budget && (budget.warn || budget.exceeded) && <BudgetBanner spent={budget.spentUsd} cap={budget.capUsd} exceeded={budget.exceeded} />}
          <main id="main" className="app-main mx-auto w-full max-w-[1120px] flex-1 px-4 pb-44 md:px-10 md:pb-16">{children}</main>
        </div>
        <Suspense fallback={null}>
          <NaviPanel
            zone={profile.timezone}
            conversation={{ id: latest?.id ?? null, messages, actions, undone }}
            ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }}
            voice={voiceAvailability()}
            focus={focus}
          />
        </Suspense>
      </div>
      <CommandPalette />
      <QuickCapture userId={ctx.userId} />
      <LiveRefresh adoptTimezone={profile.timezone === "UTC" && profile.onboarding_status === "not_started"} />
    </PanelProvider>
  );
}
