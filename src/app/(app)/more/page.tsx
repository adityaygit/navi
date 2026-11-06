import Link from "next/link";
import { MORE_LINKS } from "@/lib/nav-items";
import { requireCtx } from "@/server/context";
import { SignOutButton } from "@/components/sign-out";
import { Chevron, GROUP } from "@/components/settings-ui";

export const metadata = { title: "More · Navi" };

// One line under each link. Keep each one free of the other links' names:
// a link's accessible name includes this text.
const HINTS: Record<string, string> = {
  "/tasks": "Everything to do, by due date and area",
  "/projects": "What you're working toward",
  "/insights": "How your weeks are going",
  "/memory": "What Navi knows about you",
  "/notes": "Things you wanted to keep",
  "/activity": "What Navi did, and what waits for your OK",
  "/settings": "Schedule, quiet hours, Navi's colour",
};

export default async function MorePage() {
  const ctx = await requireCtx();
  const { count } = await ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", new Date().toISOString());
  const approvals = count ?? 0;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="h1">More</h1>
      <ul className={GROUP}>
        {MORE_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-white/[0.03] sm:px-5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[16px] font-medium">{l.label}</span>
                {HINTS[l.href] && <span className="muted truncate text-[13px]">{HINTS[l.href]}</span>}
              </span>
              {l.badge === "approvals" && approvals > 0 && <span className="badge badge-navi num">{approvals} waiting</span>}
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
      <SignOutButton className="btn w-full" />
    </div>
  );
}
