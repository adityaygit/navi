"use client";
import { useTransition, useState } from "react";
import { decideAction, setAutoApproveAction } from "./actions";

export function AutoApprove({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => start(() => setAutoApproveAction(e.target.checked))} className="h-4 w-4" />
      Approve new applications automatically
    </label>
  );
}

export function Decide({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const run = (d: "approve" | "decline", notify: boolean) => start(async () => {
    const r = await decideAction(id, d, notify);
    setMsg(r.ok ? (r.emailed ? "Done, email sent" : "Done") : r.error);
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run("approve", true)} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black">Approve</button>
      {status === "applied" && <>
        <button disabled={pending} onClick={() => run("decline", false)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50">Decline quietly</button>
        <button disabled={pending} onClick={() => run("decline", true)} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50">Decline and email</button>
      </>}
      {msg && <span role="status" className="text-sm text-neutral-500">{msg}</span>}
    </div>
  );
}
