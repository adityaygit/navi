import type { Metadata } from "next";
import Link from "next/link";
import { RequestForm } from "./request-form";
import { SkyShell } from "./shell";

export const metadata: Metadata = { title: "Early access · Navi" };

export default function EarlyAccessPage() {
  return (
    <SkyShell step={1}>
      <h1 className="sky-h1">Get Navi <em>early.</em></h1>
      <p className="sky-lead">Navi opens to a small group at a time. Leave your email and we’ll send you a short application. If you’re approved, you’ll get a sign-in link.</p>
      <RequestForm />
      <p className="sky-small">Already invited? <Link href="/login" className="sky-tlink">Sign in</Link></p>
    </SkyShell>
  );
}
