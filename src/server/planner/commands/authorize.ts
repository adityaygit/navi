import type { Impact } from "./impact";

// Who may let a schedule change run (decision D6 + the approval policy), pure.
//  - The person's own direct edits (web, phone) run: manual changes stay
//    responsive; their consequences are shown, never gated in chat.
//  - Navi: low and moderate impact run within its internal authority (with
//    Undo) unless the person chose "ask me first". High impact needs informed
//    approval: one card for the whole change, or an explicit authorization in
//    the person's own words this turn that names every high consequence.
//  - A preview the model asked for (mode "preview") is always an offer card.

export type Decision = { action: "apply" | "propose"; why: string | null };

/** Lowercase letters and digits, single-spaced. */
export function normalizeWords(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Did the person's message this turn contain the quoted words (at least two words)? */
export function quoteIsTheirs(userMessage: string | undefined, quote: string | null | undefined): boolean {
  if (!userMessage || !quote) return false;
  const q = normalizeWords(quote);
  if (q.split(" ").length < 2) return false;
  return ` ${normalizeWords(userMessage)} `.includes(` ${q} `);
}

export function decide(i: {
  actor: "user" | "navi" | "system";
  autonomy?: "auto" | "ask";
  mode?: "apply" | "preview" | "propose";
  impact: Impact;
  authorize?: string[] | null;
  userQuote?: string | null;
  userMessage?: string;
}): Decision {
  if (i.mode === "preview" || i.mode === "propose") return { action: "propose", why: "Navi suggested it; nothing changes until you approve" };
  if (i.actor === "user") return { action: "apply", why: null };
  if (i.actor === "navi" && i.autonomy === "ask") return { action: "propose", why: "you chose to approve every change" };
  const high = i.impact.consequences.filter((c) => c.level === "high");
  if (!high.length) return { action: "apply", why: null };
  const allowed = new Set(i.authorize ?? []);
  const covered = high.every((c) => allowed.has(c.key)) && quoteIsTheirs(i.userMessage, i.userQuote);
  if (covered) return { action: "apply", why: null };
  return { action: "propose", why: `it has consequences you should see first: ${high.map((c) => c.text.replace(/\.$/, "")).join("; ")}` };
}

/** Yes, sure, do it… and nothing that also says no. */
export function isAffirmative(text: string | undefined): boolean {
  if (!text) return false;
  const t = normalizeWords(text);
  if (/\b(no|nope|nah|don t|do not|dont|never|cancel|stop|wait|not)\b/.test(t)) return false;
  return /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|do that|sounds good|please do|confirm|approve|apply it|that works|perfect|great|lets do it|let s do it)\b/.test(t);
}
