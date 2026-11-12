// Text from external calendars is untrusted. It is stored and shown only as
// plain text (React escapes it), is never sent to the AI as instructions, and
// is cleaned here first: markup removed, invisible/direction-override and
// control characters dropped, whitespace tidied, length capped.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function sanitizeText(input: unknown, max: number, opts: { singleLine?: boolean } = {}): string {
  if (typeof input !== "string") return "";
  let s = input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, "\n")
    .replace(/<[^>]{0,1000}>/g, " ")
    .replace(/&(#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,8}|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k];
      const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : k.startsWith("#") ? parseInt(k.slice(1), 10) : NaN;
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    // Bidi overrides/isolates, zero-width characters, BOM, other format chars.
    .replace(/[​-‏‪-‮⁠-⁩﻿­]/g, "")
    // Control characters except newline and tab.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/\r\n?/g, "\n");
  s = opts.singleLine ? s.replace(/\s+/g, " ") : s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}
