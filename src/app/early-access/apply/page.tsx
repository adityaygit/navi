import Link from "next/link";
import type { Metadata } from "next";
import { findByToken, waitlistDb } from "@/server/waitlist";
import { ApplyForm } from "./apply-form";
import { SkyShell } from "../shell";

export const metadata: Metadata = { title: "Your application · Navi" };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const found = token ? await findByToken(waitlistDb(), token) : { state: "invalid" as const };
  if (found.state === "used") {
    return (
      <SkyShell step={3}>
        <h1 className="sky-h1">Your application <em>is in.</em></h1>
        <p className="sky-lead">This application has already been sent. We’ll email you as soon as there’s news.</p>
        <p className="sky-small">Already invited? <Link href="/login" className="sky-tlink">Sign in</Link></p>
      </SkyShell>
    );
  }
  if (found.state !== "valid") {
    return (
      <SkyShell step={1}>
        <h1 className="sky-h1">{found.state === "expired" ? "This link has expired." : "This link isn’t valid."}</h1>
        <p className="sky-lead">Application links last 14 days and work once. Ask again and we’ll send you a fresh one.</p>
        <div style={{ marginTop: 32 }}><Link href="/early-access" className="sky-btn">Ask for a new link</Link></div>
      </SkyShell>
    );
  }
  return (
    <SkyShell step={2}>
      <h1 className="sky-h1">Tell us a little <em>about you.</em></h1>
      <p className="sky-lead">Five quick questions for <b>{found.email}</b>. It takes about two minutes, and you can only send it once.</p>
      <ApplyForm token={token!} email={found.email} />
    </SkyShell>
  );
}
