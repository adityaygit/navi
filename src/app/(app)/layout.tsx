import type { CSSProperties } from "react";
import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireCtx, getProfile } from "@/server/context";
import { QuickCapture } from "@/components/quick-capture";
import { LiveRefresh } from "@/components/live-refresh";
import { BudgetBanner } from "@/components/budget-banner";
import { Sidebar, type SpaceLink } from "@/components/shell/sidebar";
import { Workspace } from "@/components/shell/navi-panel";
import { PanelProvider, PANEL_COOKIE, NAV_COOKIE } from "@/components/shell/panel-context";
import { ChatSessionProvider } from "@/components/shell/chat-session";
import { CommandPalette } from "@/components/shell/command-palette";
import { getBudgetStatus } from "@/server/ai/budget";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { listConversations } from "@/server/ai/chat";
import { loadChat } from "@/server/chat-view";
import { CHAT_COOKIE, SIDEBAR_CHATS, pickChatId, type ChatData } from "@/lib/chat-session";
import { naviColorVars } from "@/lib/navi-colors";
import { needsOnboarding, onboardingAllowed } from "@/lib/onboarding";

const NO_CHAT: ChatData = { id: null, title: null, messages: [], actions: {}, undone: [] };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  // One gate for every app page (not just Home): unfinished setup goes to /welcome.
  const h = await headers();
  const path = h.get("x-pathname") ?? "/";
  if (needsOnboarding(profile.onboarding_status) && !onboardingAllowed(path)) redirect("/welcome");

  const jar = await cookies();
  const nowIso = new Date().toISOString();
  const [inbox, approvals, budget, spacesRes, openTasksRes, focusRes, recent] = await Promise.all([
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", nowIso),
    getBudgetStatus().catch(() => null),
    ctx.db.from("workspaces").select("id,name,color").eq("status", "active").order("sort_order").order("created_at"),
    ctx.db.from("tasks").select("workspace_id").in("status", ["todo", "in_progress", "blocked"]).not("workspace_id", "is", null).is("parent_task_id", null),
    ctx.db.from("focus_sessions").select("id,started_at").is("ended_at", null).maybeSingle(),
    // One extra tells the sidebar there are more than it lists.
    listConversations(ctx, SIDEBAR_CHATS + 1),
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

  // The one current chat: in the centre on Home (named by the URL), in the panel elsewhere.
  const chats = recent.slice(0, SIDEBAR_CHATS).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
  const chatId = pickChatId(path, new URLSearchParams(h.get("x-search") ?? ""), jar.get(CHAT_COOKIE)?.value, recent[0]?.id ?? null);
  let chat = chatId ? await loadChat(ctx, chatId) : NO_CHAT;
  // Off Home, a chat that's gone (deleted elsewhere) just means a new one.
  if (chat.missing && path !== "/") chat = NO_CHAT;
  const ai = aiAvailability();

  const naviVars = naviColorVars((profile.preferences as Record<string, unknown> | null)?.navi_color) as CSSProperties;
  const panelPref = jar.get(PANEL_COOKIE)?.value === "collapsed" ? "collapsed" : "open";
  const navCollapsed = jar.get(NAV_COOKIE)?.value === "collapsed";
  const firstName = profile.display_name?.trim().split(/\s+/)[0] ?? null;
  const banner = budget && (budget.warn || budget.exceeded) ? <BudgetBanner spent={budget.spentUsd} cap={budget.capUsd} exceeded={budget.exceeded} /> : null;

  return (
    <PanelProvider initialPref={panelPref}>
      <Suspense fallback={null}>
        <ChatSessionProvider server={chat} chats={chats} moreChats={recent.length > SIDEBAR_CHATS}>
          <div className="shell relative z-[1]" style={naviVars}>
            <Sidebar name={firstName} spaces={spaces} counts={{ inbox: inbox.count ?? 0, approvals: approvals.count ?? 0 }} initialCollapsed={navCollapsed} focusLive={!!focusRow} />
            <Workspace
              zone={profile.timezone}
              banner={banner}
              ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }}
              voice={voiceAvailability()}
              focus={focus}
            >
              {children}
            </Workspace>
          </div>
          <CommandPalette />
        </ChatSessionProvider>
      </Suspense>
      <QuickCapture userId={ctx.userId} />
      <LiveRefresh adoptTimezone={profile.timezone === "UTC" && profile.onboarding_status === "not_started"} />
    </PanelProvider>
  );
}
