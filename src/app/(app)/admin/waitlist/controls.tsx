"use client";
import { useTransition, useState } from "react";
import { Switch } from "@/components/settings-ui";
import { decideAction, setAutoApproveAction } from "./actions";

export function AutoApprove({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      id="wl-auto"
      checked={on}
      disabled={pending}
      onChange={(next) => start(() => setAutoApproveAction(next))}
      label="Approve new applications automatically"
      hint="Each new application is approved and emailed a sign-in link without review."
    />
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
      <button type="button" disabled={pending} onClick={() => run("approve", true)} className="btn btn-primary btn-sm">Approve</button>
      {status === "applied" && <>
        <button type="button" disabled={pending} onClick={() => run("decline", false)} className="btn btn-sm">Decline quietly</button>
        <button type="button" disabled={pending} onClick={() => run("decline", true)} className="btn btn-sm">Decline and email</button>
      </>}
      {msg && <span role="status" className="muted text-sm">{msg}</span>}
    </div>
  );
}
