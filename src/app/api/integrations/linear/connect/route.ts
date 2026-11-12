import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/server/context";
import { linearConfig } from "@/server/linear/config";
import { authorizeUrl, newOAuthState, sealState, STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_SECONDS } from "@/server/linear/oauth";
import { settingsUrl } from "@/server/linear/redirects";

// Step 1 of the Linear OAuth flow: Settings → "Connect Linear" links here.
// Creates a fresh CSRF state + PKCE verifier, keeps them in an encrypted
// httpOnly cookie, and sends the person to Linear's consent screen.
// A plain link (GET) rather than a form, because the CSP's form-action would
// block a form submission from redirecting to linear.app.
export async function GET(request: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings#services")}`, request.nextUrl.origin));
  const cfg = linearConfig();
  if (!cfg) return NextResponse.redirect(settingsUrl(request.nextUrl.origin, "not_configured"));

  const state = newOAuthState(ctx.userId);
  const response = NextResponse.redirect(authorizeUrl(cfg, state));
  response.cookies.set(STATE_COOKIE, sealState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on Linear's top-level redirect back to the callback
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
