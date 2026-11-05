"use server";
import { revalidatePath } from "next/cache";
import { requireApiCtx } from "@/server/context";
import { decide, isAdmin, setAutoApprove, waitlistDb } from "@/server/waitlist";

async function adminEmail(): Promise<string> {
  const ctx = await requireApiCtx();
  const { data } = await ctx.db.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  if (!isAdmin(email)) throw new Error("Only admins can do this.");
  return email!;
}

export async function decideAction(id: string, decision: "approve" | "decline", notify: boolean) {
  const by = await adminEmail();
  const result = await decide(waitlistDb(), id, decision, by, undefined, undefined, { notify });
  revalidatePath("/admin/waitlist");
  return result;
}

export async function setAutoApproveAction(on: boolean) {
  const by = await adminEmail();
  await setAutoApprove(waitlistDb(), on, by);
  revalidatePath("/admin/waitlist");
}
