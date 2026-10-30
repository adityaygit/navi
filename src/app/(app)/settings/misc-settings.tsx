"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveBudgetOverrideAction } from "../actions";
import { announceChange } from "@/lib/offline-queue";

export function BudgetOverride({ exceeded }: { exceeded: boolean }) {
  const [amount, setAmount] = useState("1");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm(`Allow an extra $${amount} of AI spend today only?`)) return;
        start(async () => {
          const r = await approveBudgetOverrideAction(Number(amount));
          setMsg(r.ok ? "Override approved for today." : r.error);
          if (r.ok) announceChange();
        });
      }}
    >
      <div>
        <label htmlFor="bo" className="label text-xs">{exceeded ? "Budget reached. Allow extra today ($)" : "Extra allowance for today only ($)"}</label>
        <input id="bo" type="number" min={0.5} max={20} step={0.5} className="input w-28" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button className="btn btn-sm" disabled={pending}>Approve override</button>
      {msg && <span role="status" className="text-sm">{msg}</span>}
    </form>
  );
}

export function DangerZone() {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card flex flex-col gap-2 border-danger" aria-labelledby="dz-h">
      <h2 id="dz-h" className="h2 text-danger">Delete account</h2>
      <p className="text-sm">Permanently deletes your account and everything in Navi. Export first if you want a copy. Type DELETE to confirm.</p>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="dz" className="sr-only">Type DELETE</label>
        <input id="dz" className="input w-40" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <button
          type="button"
          className="btn btn-danger"
          disabled={confirmText !== "DELETE" || busy}
          onClick={async () => {
            setBusy(true);
            const res = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
            if (res.ok) { router.replace("/login"); router.refresh(); }
            else { setMsg((await res.json()).error); setBusy(false); }
          }}
        >
          Delete everything
        </button>
      </div>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </section>
  );
}
