"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectionError } from "@/lib/connection";
import { announceChange } from "@/lib/offline-queue";
import { connectCanvasAction, disconnectCanvasAction, refreshCanvasAction, replaceCanvasLinkAction } from "./canvas-actions";

export type CanvasConnectionView = {
  id: string;
  host: string;
  status: "active" | "error" | "reauth";
  lastSynced: string | null;
  nextSync: string | null;
  lastError: string | null;
  itemCount: number;
  summary: string;
  warnings: string[];
  duplicates: number;
};

type Res = { ok: true; message?: string } | { ok: false; error: string };

/** Runs an action and keeps its message/error for the screen. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (fn: () => Promise<Res>, after?: (r: Res) => void) =>
    start(async () => {
      setMsg(null);
      let r: Res;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: connectionError() };
      }
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      if (r.ok) {
        announceChange();
        router.refresh();
      }
      after?.(r);
    });
  return { pending, msg, go, setMsg };
}

function Steps() {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
      <li>Open Canvas in a web browser (not the app) and go to <b>Calendar</b>.</li>
      <li>Select <b>Calendar Feed</b> at the bottom of the right-hand column.</li>
      <li>Copy the link it shows and paste it here.</li>
    </ol>
  );
}

function LinkField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-medium">Canvas calendar feed link</label>
      <input
        id={id}
        className="input"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="https://yourschool.instructure.com/feeds/calendars/user_….ics"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-note`}
      />
      <span id={`${id}-note`} className="muted text-[13px] leading-snug">
        This link is private: anyone who has it can see your Canvas calendar. Navi stores it encrypted, uses it only to read your calendar, and never shows it again.
      </span>
    </div>
  );
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return msg.ok ? <p role="status" className="notice text-sm">{msg.text}</p> : <p role="alert" className="text-sm text-danger">{msg.text}</p>;
}

export function CanvasConnect({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const { pending, msg, go } = useRun();
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-medium">Canvas</span>
          <span className="muted text-[13px]">Bring in assignments and class events from your school&apos;s Canvas. Read-only: Navi never changes anything in Canvas.</span>
        </span>
        {!open && (
          <button type="button" className="btn btn-sm" disabled={!ready} onClick={() => setOpen(true)} aria-expanded={false} aria-controls="canvas-connect">
            Connect Canvas
          </button>
        )}
      </div>
      {!ready && <p className="muted text-[13px]">Not available yet: this Navi server doesn&apos;t have its encryption key set up.</p>}
      {open && (
        <form
          id="canvas-connect"
          className="flex flex-col gap-3 rounded-[14px] bg-white/[0.04] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            go(() => connectCanvasAction(link), (r) => r.ok && setLink(""));
          }}
        >
          <Steps />
          <LinkField id="canvas-link" value={link} onChange={setLink} disabled={pending} />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" disabled={pending || !link.trim()}>{pending ? "Checking and importing…" : "Connect"}</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
            {pending && <span role="status" className="muted text-[13px]">Checking the link and importing your calendar. This can take a few seconds.</span>}
          </div>
          <Message msg={msg} />
        </form>
      )}
      {!open && <Message msg={msg} />}
    </div>
  );
}

const STATUS: Record<CanvasConnectionView["status"], { label: string; cls: string }> = {
  active: { label: "connected", cls: "badge-ok" },
  error: { label: "sync problem", cls: "" },
  reauth: { label: "link needs updating", cls: "" },
};

export function CanvasConnection({ c }: { c: CanvasConnectionView }) {
  const { pending, msg, go } = useRun();
  const [confirming, setConfirming] = useState(false);
  const [removeImported, setRemoveImported] = useState(true);
  const [relink, setRelink] = useState(c.status === "reauth");
  const [link, setLink] = useState("");
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-medium">Canvas <span className="muted font-normal">· {c.host}</span></span>
          <span className="muted text-[13px]">
            {c.lastSynced ? `Last synced ${c.lastSynced}` : "Not synced yet"}
            {c.nextSync ? ` · next check ${c.nextSync}` : ""} · {c.itemCount} item{c.itemCount === 1 ? "" : "s"}
          </span>
        </span>
        <span className={`badge shrink-0 ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
      </div>

      {c.status !== "active" && c.lastError && (
        <p role="alert" className="notice notice-warn text-sm">{c.lastError} Your imported items are kept as they were.</p>
      )}
      {c.summary && <p className="text-sm">{c.summary}</p>}
      {c.warnings.map((w) => <p key={w} className="muted text-[13px]">{w}</p>)}
      {c.duplicates > 0 && (
        <p className="text-sm">
          {c.duplicates === 1 ? "1 imported assignment looks" : `${c.duplicates} imported assignments look`} like {c.duplicates === 1 ? "a task" : "tasks"} you already have.{" "}
          <Link href="/settings/canvas#decide" className="underline underline-offset-2">Decide</Link>
        </p>
      )}

      {relink && (
        <form
          className="flex flex-col gap-3 rounded-[14px] bg-white/[0.04] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            go(() => replaceCanvasLinkAction(c.id, link), (r) => r.ok && (setLink(""), setRelink(false)));
          }}
        >
          <p className="text-sm">Paste a fresh link. Everything already imported stays, and your planning on it is kept.</p>
          <Steps />
          <LinkField id={`relink-${c.id}`} value={link} onChange={setLink} disabled={pending} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={pending || !link.trim()}>{pending ? "Checking…" : "Update link"}</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setRelink(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => go(() => refreshCanvasAction(c.id))}>{pending ? "Syncing…" : "Refresh now"}</button>
          <Link className="btn btn-sm" href="/settings/canvas">Courses &amp; items</Link>
          {!relink && <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setRelink(true)}>Use a new link</button>}
          <button type="button" className="btn btn-sm btn-ghost text-clash" disabled={pending} onClick={() => setConfirming(true)}>Disconnect</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[14px] border border-[rgba(255,143,138,0.35)] p-3.5">
          <p className="text-sm">Disconnect Canvas? Navi deletes the saved link and stops syncing. Tasks you made yourself are never touched.</p>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1" checked={removeImported} onChange={(e) => setRemoveImported(e.target.checked)} />
            <span>Also remove imported Canvas events and assignments you haven&apos;t finished. Finished ones stay in your history. Untick to keep everything as your own items.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => go(() => disconnectCanvasAction(c.id, removeImported))}>{pending ? "Disconnecting…" : "Disconnect"}</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      <Message msg={msg} />
    </div>
  );
}
