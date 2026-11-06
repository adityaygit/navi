"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MORE_LINKS } from "@/lib/nav-items";
import { SignOutButton } from "./sign-out";
import { Pebble } from "./pebble";

type Counts = { inbox: number; approvals: number };

const PRIMARY: { href: string; label: string }[] = [
  { href: "/", label: "Today" },
  { href: "/chat", label: "Navi" },
  { href: "/inbox", label: "Inbox" },
  { href: "/planner", label: "Planner" },
  { href: "/projects", label: "Projects" },
  { href: "/insights", label: "Insights" },
];

function Icon({ name }: { name: "chat" | "inbox" | "planner" | "more" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "chat") return <svg {...common}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;
  if (name === "inbox") return <svg {...common}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>;
  if (name === "planner") return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>;
}

export function Nav({ counts }: { counts: Counts }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/chat" && path.startsWith("/chat")));
  const moreActive = MORE_LINKS.some((l) => active(l.href)) || path.startsWith("/more");
  const count = (href: string) => (href === "/inbox" ? counts.inbox : href === "/activity" ? counts.approvals : 0);

  return (
    <>
      {/* Desktop and tablet: one quiet top bar, like the landing page. */}
      <header className="sticky top-0 z-30 hidden border-b border-border bg-[rgba(6,6,8,0.72)] backdrop-blur-xl md:block">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Navi, go to Today">
            <Pebble size={30} />
            <span className="text-[19px] font-semibold tracking-tight">Navi</span>
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
            {PRIMARY.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active(i.href) ? "page" : undefined}
                className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-[15px] transition-colors ${active(i.href) ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"}`}
              >
                {i.label}
                {count(i.href) > 0 && <span className="badge-navi rounded-full px-1.5 text-xs font-semibold tabular-nums" aria-label={`${count(i.href)} to review`}>{count(i.href)}</span>}
              </Link>
            ))}
            <details className="relative">
              <summary className={`flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-[15px] ${moreActive ? "bg-white/[0.08] text-text" : "text-muted hover:text-text"}`}>
                More
                {counts.approvals > 0 && <span className="dot bg-[var(--navi-mid)]" aria-label={`${counts.approvals} approvals waiting`} />}
              </summary>
              <div className="lg absolute left-0 top-12 flex w-56 flex-col p-1.5">
                {MORE_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className={`flex min-h-10 items-center justify-between rounded-[10px] px-3 text-[15px] ${active(l.href) ? "bg-white/[0.08]" : "hover:bg-white/[0.06]"}`}>
                    {l.label}
                    {count(l.href) > 0 && <span className="badge-navi rounded-full px-1.5 text-xs font-semibold">{count(l.href)}</span>}
                  </Link>
                ))}
                <div className="mt-1 border-t border-border pt-1"><SignOutButton className="flex min-h-10 w-full items-center rounded-[10px] px-3 text-left text-[15px] text-muted hover:bg-white/[0.06]" /></div>
              </div>
            </details>
          </nav>
        </div>
      </header>

      {/* Phone: a floating glass dock. */}
      <nav aria-label="Main" className="glass dock fixed inset-x-4 z-30 flex items-center justify-around rounded-full px-1.5 md:hidden">
        {[
          { href: "/", label: "Today", icon: <Pebble size={26} /> },
          { href: "/chat", label: "Navi", icon: <Icon name="chat" /> },
          { href: "/inbox", label: "Inbox", icon: <Icon name="inbox" /> },
          { href: "/planner", label: "Planner", icon: <Icon name="planner" /> },
          { href: "/more", label: "More", icon: <Icon name="more" /> },
        ].map((i) => {
          const on = i.href === "/more" ? moreActive : active(i.href);
          const n = i.href === "/more" ? counts.approvals : count(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex h-[56px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-medium ${on ? "bg-white/[0.12] text-text" : "text-muted"}`}
            >
              {i.icon}
              {i.label}
              {n > 0 && <span className="absolute right-2.5 top-2 h-2.5 w-2.5 rounded-full bg-[var(--navi-mid)]" aria-label={`${n} pending`} />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
