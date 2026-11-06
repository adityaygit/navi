import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { getSettings, isAdmin, listWaitlist, waitlistDb, type WaitlistStatus } from "@/server/waitlist";
import { GROUP } from "@/components/settings-ui";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
      <header className="flex flex-col gap-3">
        <h1 className="h1">Waitlist</h1>
        <p className="muted text-[15px]">Approving adds the email to the access list and sends a sign-in link.</p>
      </header>
      <div className={GROUP}>
        <AutoApprove on={settings.auto_approve} />
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Status">
        {TABS.map((t) => (
          <a key={t.key} href={`?status=${t.key}`} aria-current={t.key === status ? "page" : undefined} className={`btn btn-sm ${t.key === status ? "btn-primary" : ""}`}>{t.label}</a>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="surf muted px-4 py-4 text-sm sm:px-5">Nobody here yet.</p>
      ) : (
        <ul className={GROUP}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2.5 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 break-words">
                  <span className="text-[16px] font-semibold">{r.name ?? r.email}</span>
                  {r.name && <span className="muted ml-2 text-sm">{r.email}</span>}
                </div>
                <span className="dim num text-[13px]">{new Date(r.applied_at ?? r.created_at).toLocaleString()} · {r.timezone ?? "timezone not given"}</span>
              </div>
              {r.reason && <p className="break-words text-sm"><span className="muted">Why: </span>{r.reason}</p>}
              {r.use_case && <p className="break-words text-sm"><span className="muted">First use: </span>{r.use_case}</p>}
              {r.referral && <p className="muted break-words text-sm">Heard via {r.referral}</p>}
              {(r.status === "applied" || r.status === "declined") && <div className="pt-1"><Decide id={r.id} status={r.status} /></div>}
              {r.status === "approved" && <p className="dim text-[13px]">Approved by {r.decided_by} · {r.decision_email_sent ? "invite emailed" : "invite email not sent"}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
