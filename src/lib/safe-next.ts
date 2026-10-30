/**
 * Where to send someone after signing in. Only a path on this same site is
 * allowed; anything that could leave it (`//evil.com`, `/\evil.com`, tabs or
 * other control characters browsers strip, `https://…`, `javascript:`) falls
 * back to "/". Returns pathname + search + hash, never an absolute URL.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next || typeof next !== "string" || !next.startsWith("/")) return "/";
  // Backslashes and control characters (incl. tab/newline, which URL parsers
  // drop) are how "/\evil.com" and "/\t/evil.com" escape the origin.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(next, base);
  } catch {
    return "/";
  }
  if (url.origin !== base.origin) return "/";
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Belt and braces: the result itself must not be protocol-relative.
  return path.startsWith("//") ? "/" : path;
}

/** Fixed sign-in error messages, so `/login?error=` can't show attacker-written text. */
export const LOGIN_ERRORS = {
  link: "That sign-in link is invalid or has expired. Ask for a new one below.",
  missing_code: "That sign-in link was incomplete. Ask for a new one below.",
  provider: "Sign-in with that provider didn't complete. Try again, or use an email link.",
  not_invited: "There's no Navi account for this email yet. Navi is invite-only: ask the owner to add you.",
} as const;
export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return (LOGIN_ERRORS as Record<string, string>)[code] ?? "Sign-in didn't complete. Try again.";
}
