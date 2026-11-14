import { config } from "../config";
import { currentToken, supabase } from "../auth/supabase";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** JSON call to the Navi server as the signed-in person. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
    throw new ApiError(res.status, msg || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Raw response, for streams (chat). */
export async function send(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  const token = await currentToken();
  const res = await fetch(config.apiBase + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (res.status === 401) {
    // The session is gone on the server side: sign out here too.
    await supabase.auth.signOut().catch(() => {});
  }
  return res;
}
