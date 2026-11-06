import type { Metadata } from "next";
import Link from "next/link";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Early access · Navi" };

export default function EarlyAccessPage() {
  return (
    <>
      <h1 className="gh text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[40px]">Request early access.</h1>
      <p className="mb-7 mt-4 text-[16px] leading-relaxed text-[#a3a5aa]">Navi opens to a small group at a time. Leave your email and we’ll send you a short application. If you’re approved, you’ll get a sign-in link.</p>
      <RequestForm />
      <p className="mt-6 text-sm text-[#a3a5aa]">Already invited? <Link href="/login" className="font-medium text-[#f2f2f2] underline-offset-4 hover:underline">Sign in</Link></p>
    </>
  );
}
