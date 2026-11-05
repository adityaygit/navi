import Link from "next/link";
import type { Metadata } from "next";
import { findByToken, waitlistDb } from "@/server/waitlist";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Your application · Navi" };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const found = token ? await findByToken(waitlistDb(), token) : { state: "invalid" as const };
  if (found.state !== "valid") {
    const msg = found.state === "used" ? "This application has already been sent. We’ll email you when there’s news." : found.state === "expired" ? "This link has expired." : "This link isn’t valid.";
    return (
      <>
        <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.04em]">{msg}</h1>
        {found.state !== "used" && <p className="mt-5 text-[17px] text-[#8f949b]"><Link href="/early-access" className="text-[#f2f2f2] underline underline-offset-4">Ask for early access again</Link> to get a new link.</p>}
      </>
    );
  }
  return (
    <>
      <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.04em]">Tell us a little about you.</h1>
      <p className="mb-10 mt-5 text-[17px] leading-relaxed text-[#8f949b]">Five quick questions for {found.email}. It takes about two minutes, and you can only send it once.</p>
      <ApplyForm token={token!} email={found.email} />
    </>
  );
}
