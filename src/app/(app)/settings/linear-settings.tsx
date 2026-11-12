import { DateTime } from "luxon";
import { ActionButton } from "@/components/action-button";
import type { LinearConnectionView } from "@/server/linear/connections";
import { disconnectLinearAction, syncLinearAction } from "./linear-actions";

// Settings → Integrations → Linear. Read-only import of the issues assigned to
// you. Connect is a plain link to the OAuth start route (server-side flow).

const CONNECT_HREF = "/api/integrations/linear/connect";

function when(iso: string | null, zone: string): string | null {
  return iso ? DateTime.fromISO(iso).setZone(zone).toRelative() : null;
}

function LinearMark() {
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.08]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 13.5 10.5 20M3.6 9.6 14.4 20.4M5.6 6.1l12.3 12.3M8.7 4.2l11.1 11.1M12.6 3.6a8.5 8.5 0 0 1 7.8 7.8" />
      </svg>
    </span>
  );
}

export function LinearSettings({ connections, configured, zone }: { connections: LinearConnectionView[]; configured: boolean; zone: string }) {
  if (!configured) {
    return (
      <li className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <LinearMark />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium">Linear</span>
          <span className="muted text-[13px]">Import issues assigned to you. Not available yet: the server needs its Linear settings.</span>
        </span>
        <span className="badge shrink-0">not set up</span>
      </li>
    );
  }

  if (!connections.length) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
        <LinearMark />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium">Linear</span>
          <span className="muted text-[13px]">Bring the issues assigned to you into Tasks, with their priority, status and due date. Read-only: Navi never changes anything in Linear.</span>
        </span>
        <a className="btn btn-sm shrink-0" href={CONNECT_HREF}>Connect Linear</a>
      </li>
    );
  }

  return (
    <>
      {connections.map((c) => {
        const reauth = c.status === "needs_reauth";
        const synced = when(c.last_sync_ok_at, zone);
        const stats = c.last_sync_stats;
        return (
          <li key={c.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-3">
              <LinearMark />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-medium">Linear · {c.external_org_name ?? "workspace"}</span>
                <span className="muted text-[13px]">
                  {c.external_user_name ? `As ${c.external_user_name} · ` : ""}read-only
                  {synced ? ` · synced ${synced}` : " · not synced yet"}
                  {stats ? ` · ${stats.open} open issue${stats.open === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <span className={`badge shrink-0 ${reauth ? "badge-warn" : "badge-ok"}`}>{reauth ? "reconnect needed" : "connected"}</span>
            </div>
            {reauth && <p role="status" className="text-[13px] text-recovery">{c.status_detail ?? "Linear access expired or was revoked."} Imported tasks stay; they just stop updating.</p>}
            {!reauth && c.last_sync_error && <p role="status" className="text-[13px] text-recovery">Last sync didn&apos;t finish: {c.last_sync_error}</p>}
            {!reauth && stats?.truncated && <p className="muted text-[13px]">Only the 1,000 most recently updated issues are imported.</p>}
            <div className="flex flex-wrap items-start gap-2">
              {reauth ? (
                <a className="btn btn-sm" href={CONNECT_HREF}>Reconnect Linear</a>
              ) : (
                <ActionButton action={syncLinearAction} args={[c.id]} showResult>Sync now</ActionButton>
              )}
              <ActionButton
                action={disconnectLinearAction}
                args={[c.id]}
                showResult
                confirm={`Disconnect Linear (${c.external_org_name ?? "workspace"})? Navi's access is revoked. Imported tasks stay in Navi as your own tasks.`}
              >
                Disconnect
              </ActionButton>
            </div>
          </li>
        );
      })}
      <li className="px-4 py-3 sm:px-5">
        <a className="muted text-[13px] underline-offset-2 hover:text-text hover:underline" href={CONNECT_HREF}>Connect another Linear workspace</a>
      </li>
    </>
  );
}
