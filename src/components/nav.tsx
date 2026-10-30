"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Today", mobile: true },
  { href: "/chat", label: "Navi", mobile: true },
  { href: "/inbox", label: "Inbox", mobile: true, badge: "inbox" as const },
  { href: "/planner", label: "Planner", mobile: true },
  { href: "/tasks", label: "Tasks" },
  { href: "/projects", label: "Projects & Goals" },
  { href: "/insights", label: "Insights" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity", badge: "approvals" as const },
  { href: "/settings", label: "Settings" },
];

export function Nav({ counts }: { counts: { inbox: number; approvals: number } }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const badge = (key?: "inbox" | "approvals") =>
    key && counts[key] > 0 ? (
      <span className="badge badge-accent ml-auto" aria-label={`${counts[key]} pending`}>{counts[key]}</span>
    ) : null;
  return (
    <>
      <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border p-3 md:flex">
        <div className="px-2 pb-3 pt-1 text-lg font-semibold">Navi</div>
        {ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active(i.href) ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-lg px-3 text-sm ${active(i.href) ? "bg-accent-soft font-medium text-accent" : "hover:bg-surface-2"}`}
          >
            {i.label}
            {badge(i.badge)}
          </Link>
        ))}
        <form action="/auth/signout" method="post" className="mt-auto">
          <button className="btn btn-ghost btn-sm w-full justify-start">Sign out</button>
        </form>
      </nav>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden safe-bottom">
        {ITEMS.filter((i) => i.mobile).map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active(i.href) ? "page" : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center text-xs ${active(i.href) ? "font-semibold text-accent" : "text-muted"}`}
          >
            {i.label}
            {i.badge && counts[i.badge] > 0 && (
              <span className="absolute right-[22%] top-2 h-2 w-2 rounded-full bg-accent" aria-label={`${counts[i.badge]} pending`} />
            )}
          </Link>
        ))}
        <Link href="/more" aria-current={path.startsWith("/more") ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center text-xs ${path.startsWith("/more") ? "font-semibold text-accent" : "text-muted"}`}>
          More
          {counts.approvals > 0 && <span className="sr-only">{counts.approvals} approvals pending</span>}
        </Link>
      </nav>
    </>
  );
}

export const MORE_LINKS = ITEMS.filter((i) => !i.mobile);
