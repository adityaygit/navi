"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx, type Ctx } from "@/server/context";
import { UserFacingError } from "@/server/http";
import { connectFeed, disconnectFeed, refreshConnection, replaceFeedUrl, resolveDuplicate, setCourseExcluded, setCourseLink, setItemHidden } from "@/server/integrations/connections";
import { feedSummaryText } from "@/lib/feed-summary";
import type { SyncOutcome } from "@/server/integrations/feed-sync";

// Server actions for Settings → Connected services → Canvas. The feed link is
// accepted here and never sent back. Errors written for people are shown;
// anything else becomes a generic message (details stay in server logs).

type Result = { ok: true; message?: string } | { ok: false; error: string; changed?: boolean };

const Id = z.string().uuid();
const Link = z.string().trim().min(1, "Paste your Canvas calendar feed link.").max(2000, "That link is too long.");

async function run(fn: (ctx: Ctx) => Promise<string | undefined | void>): Promise<Result> {
  try {
    const ctx = await requireApiCtx();
    const message = (await fn(ctx)) ?? undefined;
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof UserFacingError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "That didn't look right." };
    const ref = Math.random().toString(36).slice(2, 10);
    console.error(`[canvas action ${ref}]`, err instanceof Error ? err.message.slice(0, 300) : "unknown");
    return { ok: false, error: `Something went wrong on the server (ref ${ref}). Nothing you imported was lost.` };
  }
}

function outcomeMessage(o: SyncOutcome): string {
  if (!o.ok) throw new UserFacingError(o.message);
  return [feedSummaryText({ ...o.counts, warnings: o.warnings, trigger: "manual" }), ...o.warnings].join(" ");
}

export async function connectCanvasAction(link: string): Promise<Result> {
  return run(async (ctx) => {
    const { outcome } = await connectFeed(ctx, "canvas", Link.parse(link));
    if (!outcome.ok) return `Connected, but the first import didn't finish: ${outcome.message}`;
    return [feedSummaryText({ ...outcome.counts, trigger: "connect" }), ...outcome.warnings].join(" ");
  });
}

export async function refreshCanvasAction(connectionId: string): Promise<Result> {
  return run(async (ctx) => outcomeMessage(await refreshConnection(ctx, Id.parse(connectionId))));
}

export async function replaceCanvasLinkAction(connectionId: string, link: string): Promise<Result> {
  return run(async (ctx) => outcomeMessage(await replaceFeedUrl(ctx, Id.parse(connectionId), Link.parse(link))));
}

export async function disconnectCanvasAction(connectionId: string, removeImported: boolean): Promise<Result> {
  return run(async (ctx) => {
    const r = await disconnectFeed(ctx, Id.parse(connectionId), { removeImported: removeImported === true });
    return removeImported ? `Disconnected. Removed ${r.removedTasks} unfinished imported task${r.removedTasks === 1 ? "" : "s"} and ${r.removedEvents} event${r.removedEvents === 1 ? "" : "s"}.` : "Disconnected. Imported items are now your own.";
  });
}

export async function hideCanvasItemAction(itemId: string, hidden: boolean): Promise<Result> {
  return run(async (ctx) => void (await setItemHidden(ctx, Id.parse(itemId), hidden === true)));
}

export async function resolveCanvasDuplicateAction(itemId: string, choice: "keep_both" | "use_mine"): Promise<Result> {
  return run(async (ctx) => void (await resolveDuplicate(ctx, Id.parse(itemId), z.enum(["keep_both", "use_mine"]).parse(choice))));
}

export async function setCanvasCourseExcludedAction(courseId: string, excluded: boolean): Promise<Result> {
  return run(async (ctx) => void (await setCourseExcluded(ctx, Id.parse(courseId), excluded === true)));
}

/** target: "" (none), "w:<space id>" or "p:<project id>". */
export async function setCanvasCourseLinkAction(courseId: string, target: string): Promise<Result> {
  return run(async (ctx) => {
    const m = z.string().regex(/^(|[wp]:[0-9a-f-]{36})$/).parse(target);
    await setCourseLink(ctx, Id.parse(courseId), m ? { kind: m.startsWith("p:") ? "project" : "workspace", id: m.slice(2) } : null);
  });
}
