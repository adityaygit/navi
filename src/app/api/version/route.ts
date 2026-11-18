import { NextResponse } from "next/server";

// Which code is live: the deployment's Git commit (Vercel system variable).
// Public and harmless: no user data, no configuration values.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local", branch: process.env.VERCEL_GIT_COMMIT_REF ?? null, environment: process.env.VERCEL_ENV ?? "local" },
    { headers: { "cache-control": "no-store" } },
  );
}
