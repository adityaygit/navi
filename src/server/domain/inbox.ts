import "server-only";
import type { Ctx } from "@/server/context";
import type { Proposal } from "@/lib/types";

// The review inbox as the web page (/inbox) and the phone app (/api/m/inbox)
// both show it: pending suggestions grouped by where they came from, the
// "Later" pile, recent captures, and the area each suggestion would land in.

export type InboxCapture = { id: string; raw_text: string; status: string; error: string | null; captured_at: string; source: string };
export type InboxArea = { name: string; color: string | null };
export type InboxGroup = { key: string; capture: InboxCapture | null; label: string; items: Proposal[] };

export type Inbox = {
  pending: Proposal[];
  deferred: Proposal[];
  openTasks: { id: string; title: string }[];
  recent: InboxCapture[];
  groups: InboxGroup[];
  areaOf: (p: Proposal) => InboxArea | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTURE_COLUMNS = "id,raw_text,status,error,captured_at,source";

export async function loadInbox(ctx: Ctx): Promise<Inbox> {
  const [proposalsRes, tasksRes, capturesRes, wsRes, refsRes] = await Promise.all([
    ctx.db.from("proposals").select("*").in("status", ["pending", "deferred"]).is("batch", null).order("created_at", { ascending: false }),
    ctx.db.from("tasks").select("id,title").in("status", ["todo", "in_progress", "blocked"]).order("updated_at", { ascending: false }).limit(100),
    ctx.db.from("captures").select(CAPTURE_COLUMNS).order("captured_at", { ascending: false }).limit(10),
    ctx.db.from("workspaces").select("id,name,color"),
    // Area proposals other items may point at by ref_key (accepted ones resolve to a real area).
    ctx.db.from("proposals").select("ref_key,payload,result_id").eq("kind", "workspace").not("ref_key", "is", null),
  ]);
  const all = (proposalsRes.data ?? []) as Proposal[];
  const pending = all.filter((p) => p.status === "pending");
  const deferred = all.filter((p) => p.status === "deferred");
  const openTasks = (tasksRes.data ?? []) as { id: string; title: string }[];
  const recent = (capturesRes.data ?? []) as InboxCapture[];

  // The captures these suggestions came from, so each group shows your own words first.
  const recentIds = new Set(recent.map((c) => c.id));
  const missing = [...new Set(pending.map((p) => p.capture_id).filter((id): id is string => Boolean(id) && !recentIds.has(id!)))];
  const extra = missing.length ? (((await ctx.db.from("captures").select(CAPTURE_COLUMNS).in("id", missing)).data ?? []) as InboxCapture[]) : [];
  const captureById = new Map([...recent, ...extra].map((c) => [c.id, c]));

  // Which life area each suggestion would land in, when it says.
  const wsById = new Map((wsRes.data ?? []).map((w) => [w.id as string, { name: w.name as string, color: (w.color as string | null) ?? null }]));
  const wsByRef = new Map(
    (refsRes.data ?? []).map((r) => {
      const real = r.result_id ? wsById.get(r.result_id as string) : undefined;
      const pl = (r.payload ?? {}) as Record<string, unknown>;
      return [r.ref_key as string, real ?? { name: String(pl.name ?? "New area"), color: typeof pl.color === "string" ? pl.color : null }];
    }),
  );
  const areaOf = (p: Proposal): InboxArea | null => {
    const pl = p.payload as Record<string, unknown>;
    if (typeof pl.workspace_id === "string") return wsById.get(pl.workspace_id) ?? null;
    const ref = pl.workspace_ref;
    if (typeof ref !== "string" || !ref) return null;
    return (UUID.test(ref) ? wsById.get(ref) : wsByRef.get(ref)) ?? null;
  };

  // Group by where they came from: one capture, a chat, or anywhere else.
  const groups: InboxGroup[] = [];
  for (const p of pending) {
    const cap = p.capture_id ? captureById.get(p.capture_id) ?? null : null;
    const key = cap ? `c:${cap.id}` : p.conversation_id ? "chat" : "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, capture: cap, label: cap ? "" : key === "chat" ? "From your chats with Navi" : "Other suggestions", items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }
  return { pending, deferred, openTasks, recent, groups, areaOf };
}
