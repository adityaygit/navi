"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { placeTask } from "@/server/planner/place";

/**
 * "Put it there" on My day: the person places an unscheduled task into a free
 * stretch (see placeTask; the phone app calls the same function).
 */
export async function placeTaskAction(input: { taskId: string; startsAt: string; minutes: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireApiCtx();
    await placeTask(ctx, input);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    const error = err instanceof z.ZodError ? "That time isn't valid." : err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
