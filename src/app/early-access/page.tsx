import type { Metadata } from "next";
import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Early access · Navi" };

export default function EarlyAccessPage() {
  return (
    <>
      <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.04em]">Request early access.</h1>
      <p className="mb-8 mt-5 text-[17px] leading-relaxed text-[#8f949b]">Navi opens to a small group at a time. Leave your email and we’ll send you a short application. If you’re approved, you’ll get a sign-in link.</p>
      <RequestForm />
    </>
  );
}
