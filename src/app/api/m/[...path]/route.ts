import type { NextRequest } from "next/server";
import { dispatch } from "@/server/mobile/router";

// The phone app's JSON API (/api/m/*). Routes, auth and errors live in
// src/server/mobile/router.ts; CORS preflights are answered by src/proxy.ts.
export const maxDuration = 60;

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, { params }: Context) {
  return dispatch(request, (await params).path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
