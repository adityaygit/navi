"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Stone } from "./stone";
import { NAV_COOKIE, setShellCookie } from "./panel-context";
import { shortcutLabel } from "@/lib/viewing";
import { SignOutButton } from "../sign-out";
import { useChatSession } from "./chat-session";
import { SidebarChats } from "./sidebar-chats";
import { spaceColor } from "@/lib/space-color";

export { spaceColor };

export type SpaceLink = { id: string; name: string; color: string | null; open: number };

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const ICONS = {
  home: <svg {...icon}><path d="M4 10.5 12 4l8 6.5V20H4z" /></svg>,
  tasks: <svg {...icon}><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>,
  day: <svg {...icon}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /></svg>,
  inbox: <svg {...icon}><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6z" /></svg>,
  focus: <svg {...icon}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>,
};

const PRIMARY = [
  { href: "/", label: "Home", icon: ICONS.home },
  { href: "/tasks", label: "Tasks", icon: ICONS.tasks },
  { href: "/planner", label: "My day", icon: ICONS.day },
  { href: "/inbox", label: "Inbox", icon: ICONS.inbox },
  { href: "/focus", label: "Focus", icon: ICONS.focus },
];

const MORE = [
  { href: "/projects", label: "Projects and goals" },
  { href: "/insights", label: "Insights" },
  { href: "/review", label: "Reviews" },
  { href: "/memory", label: "Memory" },
  { href: "/notes", label: "Notes" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({
  name,
  spaces,
  counts,
  initialCollapsed,
  focusLive,
}: {
  name: string | null;
  spaces: SpaceLink[];
  counts: { inbox: number; approvals: number };
  initialCollapsed: boolean;
  focusLive: boolean;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const session = useChatSession();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [kbd, setKbd] = useState("Ctrl K");
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const update = () => setEdges({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(content);
    update();
    return () => { observer.disconnect(); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({ top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 });
    setScrolling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setScrolling(false), 1000);
  };
  useEffect(() => {
    // The platform is only known in the browser; the label is a hint, not content.
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKbd(shortcutLabel(nav.userAgentData?.platform ?? nav.platform));
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const activeSpace = path === "/tasks" ? search.get("space") : null;
  const toggle = () => {
    setCollapsed((c) => {
      setShellCookie(NAV_COOKIE, c ? "open" : "collapsed");
      return !c;
    });
  };
  const initial = (name ?? "").trim().charAt(0).toUpperCase() || "·";

  return (
    <div className={`relative hidden min-h-0 shrink-0 md:block ${collapsed ? "w-[68px]" : "w-[236px]"}`}>
    <nav
      ref={scrollRef}
      onScroll={onScroll}
      aria-label="Main"
      className={`sidebar-scroll h-full overflow-y-auto ${scrolling ? "is-scrolling" : ""}`}
    >
      <div ref={contentRef} className="flex min-h-full flex-col gap-0.5 px-3 py-[18px]">
      <div className={`mb-4 flex h-[34px] items-center gap-2.5 ${collapsed ? "justify-center" : "px-2.5"}`}>
        <button type="button" onClick={toggle} className="flex items-center gap-2.5 rounded-full" aria-label={collapsed ? "Expand the sidebar" : "Navi, collapse the sidebar"} aria-expanded={!collapsed}>
          <Stone size={18} />
          {!collapsed && <span className="text-[16px] font-bold tracking-[-0.01em]">Navi</span>}
        </button>
        {!collapsed && <span className="flex-1" />}
        {!collapsed && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("navi:palette"))}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-dim hover:bg-white/[0.06] hover:text-text"
            aria-label={`Search and commands, ${kbd}`}
            title={`Search and commands (${kbd})`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          </button>
        )}
      </div>

      <Link
        href="/"
        onClick={() => session.requestFocus("center")}
        className={`mb-2 flex h-9 items-center gap-3 rounded-[12px] border border-white/[0.08] text-[14px] font-medium text-text transition-colors hover:bg-white/[0.06] ${collapsed ? "justify-center px-0" : "px-3"}`}
        title={collapsed ? "New chat" : undefined}
      >
        <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>
        {collapsed ? <span className="sr-only">New chat</span> : <span>New chat</span>}
      </Link>

      {PRIMARY.map((i) => {
        const n = i.href === "/inbox" ? counts.inbox : 0;
        return (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`side-link ${collapsed ? "justify-center px-0" : ""}`} title={collapsed ? i.label : undefined}>
            <span className="relative">
              {i.icon}
              {collapsed && n > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--navi-text)]" />}
              {i.href === "/focus" && focusLive && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-focus" aria-hidden="true" />}
            </span>
            {!collapsed ? <span className="flex-1">{i.label}</span> : <span className="sr-only">{i.label}</span>}
            {i.href === "/focus" && focusLive && <span className="sr-only">, running</span>}
            {!collapsed && n > 0 && (
              <span className="rounded-[10px] bg-[var(--navi-text)] px-[7px] py-px text-[12px] font-semibold text-black" aria-label={`${n} to review`}>{n}</span>
            )}
          </Link>
        );
      })}

      {!collapsed && spaces.length > 0 && (
        <>
          <div className="mb-2 mt-[26px] px-3 text-[12.5px] font-medium text-dim" id="spaces-label">Spaces</div>
          <ul aria-labelledby="spaces-label" className="flex flex-col">
            {spaces.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/tasks?space=${s.id}`}
                  aria-current={activeSpace === s.id ? "page" : undefined}
                  className="flex h-[34px] items-center gap-3 rounded-[12px] px-3 text-[14px] text-[#C8C8CE] hover:bg-white/[0.04] aria-[current=page]:bg-white/[0.08]"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: spaceColor(s) }} aria-hidden="true" />
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.open > 0 && <span className="text-dim tabular-nums" aria-label={`${s.open} open`}>{s.open}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!collapsed && <SidebarChats />}

      <span className="flex-1" />
      <details className="group relative" onToggle={(event) => {
        const details = event.currentTarget;
        if (details.open) requestAnimationFrame(() => details.querySelector<HTMLElement>(".account-menu")?.scrollIntoView({ block: "nearest" }));
      }}>
        <summary className={`flex h-11 cursor-pointer list-none items-center gap-3 rounded-[12px] hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden ${collapsed ? "justify-center" : "px-2.5"}`}>
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[#1C1C1F] text-[12px] font-semibold">
            {initial}
            {counts.approvals > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--navi-text)]" aria-label={`${counts.approvals} approvals waiting`} />}
          </span>
          {!collapsed && <span className="flex-1 truncate text-[14px] text-[#C8C8CE]">{name || "You"}</span>}
          {!collapsed && <span className="sr-only">More pages and settings</span>}
        </summary>
        <div className="account-menu absolute bottom-12 left-0 z-40 flex w-56 flex-col rounded-[16px] border border-border bg-[#111113] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          {MORE.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className="flex min-h-9 items-center justify-between rounded-[10px] px-3 text-[14px] text-muted hover:bg-white/[0.06] hover:text-text aria-[current=page]:text-text">
              {l.label}
              {l.href === "/activity" && counts.approvals > 0 && <span className="rounded-[10px] bg-[var(--navi-text)] px-1.5 text-[12px] font-semibold text-black">{counts.approvals}</span>}
            </Link>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <SignOutButton className="flex min-h-9 w-full items-center rounded-[10px] px-3 text-left text-[14px] text-muted hover:bg-white/[0.06]" />
          </div>
        </div>
      </details>
      </div>
    </nav>
    {edges.top && <div aria-hidden="true" className="sidebar-fade sidebar-fade-top" />}
    {edges.bottom && <div aria-hidden="true" className="sidebar-fade sidebar-fade-bottom" />}
    </div>
  );
}
