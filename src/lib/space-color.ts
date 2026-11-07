const SPACE_COLORS = ["#9DB8FF", "#F2A7A0", "#C7A6F7", "#F4B37A", "#E9C46A", "#8EC5E6", "#A7EBC0", "#F7A6D8"];

/** A space's dot colour: its own colour if set, else a stable one picked from its id. */
export function spaceColor(s: { id: string; color: string | null }): string {
  if (s.color && /^#[0-9a-f]{6}$/i.test(s.color)) return s.color;
  let h = 0;
  for (const ch of s.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SPACE_COLORS[h % SPACE_COLORS.length];
}
