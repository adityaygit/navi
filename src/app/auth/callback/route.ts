import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeNext, type LoginErrorCode } from "@/lib/safe-next";

const fail = (code: LoginErrorCode, origin: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin));

// OAuth (Google) and magic-link PKCE callback.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);
  // Provider error text is never echoed back to the page.
  if (url.searchParams.get("error_description") || url.searchParams.get("error")) {
    const text = `${url.searchParams.get("error_description") ?? ""} ${url.searchParams.get("error") ?? ""}`;
    return fail(/signups? not allowed|invite-only|access list/i.test(text) ? "not_invited" : "provider", url.origin);
  }
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    return fail("link", url.origin);
  }
  return fail("missing_code", url.origin);
}
