import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { getSettings, isAdmin, listWaitlist, waitlistDb, type WaitlistStatus } from "@/server/waitlist";
import { AutoApprove, Decide } from "./controls";

const TABS: { key: WaitlistStatus; label: string }[] = [
  { key: "applied", label: "To review" }, { key: "requested", label: "Waiting on form" }, { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" },
];

export default async function WaitlistAdmin({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireCtx();
  const { data } = await ctx.db.auth.getClaims();
  if (!isAdmin(data?.claims?.email as string | undefined)) notFound();
  const wanted = (await searchParams).status;
  const status = (TABS.find((t) => t.key === wanted)?.key ?? "applied") as WaitlistStatus;
  const db = waitlistDb();
  const [rows, settings] = await Promise.all([listWaitlist(db, status), getSettings(db)]);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Waitlist</h1><p className="text-sm text-neutral-500">Approving adds the email to the access list and sends a sign-in link.</p></div>
        <AutoApprove on={settings.auto_approve} />
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Status">
        {TABS.map((t) => <a key={t.key} href={`?status=${t.key}`} aria-current={t.key === status ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${t.key === status ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : ""}`}>{t.label}</a>)}
      </nav>
      {rows.length === 0 ? <p className="text-sm text-neutral-500">Nobody here yet.</p> : (
        <ul className="divide-y rounded-xl border">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><span className="font-medium">{r.name ?? r.email}</span>{r.name && <span className="ml-2 text-sm text-neutral-500">{r.email}</span>}</div>
                <span className="text-xs text-neutral-500">{new Date(r.applied_at ?? r.created_at).toLocaleString()} · {r.timezone ?? "timezone not given"}</span>
              </div>
              {r.reason && <p className="text-sm"><span className="text-neutral-500">Why: </span>{r.reason}</p>}
              {r.use_case && <p className="text-sm"><span className="text-neutral-500">First use: </span>{r.use_case}</p>}
              {r.referral && <p className="text-sm text-neutral-500">Heard via {r.referral}</p>}
              {(r.status === "applied" || r.status === "declined") && <Decide id={r.id} status={r.status} />}
              {r.status === "approved" && <p className="text-xs text-neutral-500">Approved by {r.decided_by} · {r.decision_email_sent ? "invite emailed" : "invite email not sent"}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
