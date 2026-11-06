"use client";
import { connectionError } from "@/lib/connection";
import { useState, useTransition } from "react";
import { clearDeviceDataForDeletedAccount } from "@/lib/device-privacy";
import { useRouter } from "next/navigation";
import { approveBudgetOverrideAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { SectionHead } from "@/components/settings-ui";

export function BudgetOverride({ exceeded }: { exceeded: boolean }) {
  const [amount, setAmount] = useState("1");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor="bo" className="text-[15px] font-medium">{exceeded ? "Budget reached. Allow extra today ($)" : "Extra allowance for today only ($)"}</label>
        <span className="muted text-[13px]">Applies today only; tomorrow starts from the normal cap.</span>
        {msg && <span role="status" className="text-[13px]">{msg}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input id="bo" type="number" min={0.5} max={20} step={0.5} className="input num w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn btn-sm" disabled={pending}>Approve override</button>
      </div>
    </form>
  );
}

export function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const emailMatches = confirmEmail.trim().toLowerCase() === email.toLowerCase() && email !== "";
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section id="delete" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="dz-h">
      <SectionHead id="dz-h" tone="danger" title="Delete account" desc="Permanently deletes your account and everything in Navi. Export first if you want a copy." />
      <div className="surf flex flex-col gap-3 border-[rgba(255,143,138,0.35)] px-4 py-4 sm:px-5">
        <p className="text-sm">To confirm, type DELETE and your account&apos;s email.</p>
        <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
          <label htmlFor="dz" className="sr-only">Type DELETE</label>
          <input id="dz" className="input" placeholder="DELETE" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <label htmlFor="dz-email" className="sr-only">Your email</label>
          <input id="dz-email" type="email" autoComplete="off" placeholder="your email" className="input" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
          <button
            type="button"
            className="btn btn-danger"
            disabled={confirmText !== "DELETE" || !emailMatches || busy}
            onClick={async () => {
              setBusy(true);
              const res = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE", email: confirmEmail.trim() }) }).catch(() => null);
              if (res?.ok) { await clearDeviceDataForDeletedAccount(); router.replace("/login"); router.refresh(); }
              else { setMsg(res ? (await res.json().catch(() => ({}))).error ?? "Couldn't delete the account." : connectionError()); setBusy(false); }
            }}
          >
            Delete everything
          </button>
        </div>
        {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
      </div>
    </section>
  );
}
