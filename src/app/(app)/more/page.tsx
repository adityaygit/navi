import Link from "next/link";
import { MORE_LINKS } from "@/lib/nav-items";
import { SignOutButton } from "@/components/sign-out";

export const metadata = { title: "More · Navi" };

export default function MorePage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="h1">More</h1>
      <ul className="card flex flex-col p-0">
        {MORE_LINKS.map((l) => (
          <li key={l.href} className="border-b border-border last:border-0">
            <Link href={l.href} className="flex min-h-12 items-center px-4">{l.label}</Link>
          </li>
        ))}
      </ul>
      <SignOutButton className="btn w-full" />
    </div>
  );
}
