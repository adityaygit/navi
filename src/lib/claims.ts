// Navi must never report an action as done because the model wrote that it
// was. A reply's claims ("I've added…", "I sent you a card…", "I moved…") are
// checked against what this turn's tools actually did (their verified
// results). Pure and deterministic: no model call.
//
// Only first-person claims of a finished action in this reply are checked.
// Offers ("I can move it"), negations ("I couldn't move it") and references
// to earlier turns ("earlier I moved…", "it's already on your list") are not
// claims about this turn.

export type TurnStep = {
  name: string;
  ok: boolean;
  /** The tool changed something (per its own verified result). */
  mutated: boolean;
  /** It made (or updated) an approval card. */
  actionId?: string | null;
};

export type ClaimKind = "card" | "done" | "removed" | "created" | "scheduled" | "generic";

export type UnsupportedClaim = { kind: ClaimKind; sentence: string };

const I = String.raw`\b(?:I(?:'ve|’ve| have)?|I just|I've just|I’ve just)`;
const PATTERNS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: "card", re: new RegExp(String.raw`${I} (?:sent|made|put up|put|created|added|opened|raised|set up|shown|posted)\b[^.!?\n]{0,40}\b(?:card|approval)\b`, "i") },
  { kind: "card", re: /\b(?:approve (?:it|the card|that card|the change)|tap approve|(?:is|it's|it’s|that's) waiting for your (?:approval|ok|okay|tap))\b/i },
  { kind: "done", re: new RegExp(String.raw`${I} (?:marked|checked off|ticked off|completed)\b`, "i") },
  { kind: "removed", re: new RegExp(String.raw`${I} (?:deleted|removed|cleared|dropped|cancelled|canceled|taken (?:it|that|them|this) off)\b`, "i") },
  { kind: "created", re: new RegExp(String.raw`${I} (?:added|created|saved|captured|logged|set (?:a|the) reminder)\b`, "i") },
  { kind: "scheduled", re: new RegExp(String.raw`${I} (?:moved|rescheduled|scheduled|planned|re-?planned|pinned|locked|blocked out|booked|put (?:it|that|them|this|the \w+) (?:at|on|in|into|for))\b`, "i") },
  { kind: "generic", re: /^\s*(?:done|all set|all done|got it, done)[.!]/i },
];

/** Words that make a sentence not a claim of something finished in this turn. */
const NOT_A_CLAIM = /\b(?:couldn'?t|could not|can'?t|cannot|didn'?t|did not|haven'?t|have not|hasn'?t|won'?t|wasn'?t|not yet|unable|failed|earlier|before|previously|last time|yesterday|already|if you|once you|want me to|should i|would you like|i can|i'll|i will|i’ll|can’t|couldn’t|didn’t|haven’t|won’t|wasn’t)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function supported(kind: ClaimKind, steps: TurnStep[]): boolean {
  const changed = steps.filter((s) => s.ok && s.mutated);
  const card = steps.some((s) => s.ok && !!s.actionId);
  switch (kind) {
    case "card":
      return card;
    case "done":
      return card || changed.some((s) => ["complete_task", "resolve_overdue_imports", "update_task", "update_item", "change_block", "plan"].includes(s.name));
    case "removed":
      return card || changed.length > 0;
    case "created":
    case "scheduled":
    case "generic":
      return card || changed.length > 0;
  }
}

/** Claims in `text` that no successful step of this turn backs up. */
export function unsupportedClaims(text: string, steps: TurnStep[]): UnsupportedClaim[] {
  const out: UnsupportedClaim[] = [];
  for (const sentence of sentences(text)) {
    if (NOT_A_CLAIM.test(sentence)) continue;
    const hit = PATTERNS.find((p) => p.re.test(sentence));
    if (hit && !supported(hit.kind, steps)) out.push({ kind: hit.kind, sentence });
  }
  return out;
}

const WHAT: Record<ClaimKind, string> = {
  card: "made an approval card",
  done: "marked something done",
  removed: "removed or cancelled something",
  created: "added or saved something",
  scheduled: "moved or scheduled something",
  generic: "completed the request",
};

/** The note the model gets when its reply claims something no tool did (one correction pass). */
export function correctionNote(claims: UnsupportedClaim[], steps: TurnStep[]): string {
  const did = steps.length
    ? steps.map((s) => `${s.name}: ${s.ok ? (s.actionId ? "made a card" : s.mutated ? "changed something" : "ran, changed nothing") : "FAILED"}`).join("; ")
    : "no tools ran";
  return (
    `[Navi system check, not from the user] Your reply says you ${[...new Set(claims.map((c) => WHAT[c.kind]))].join(" and ")} (“${claims[0].sentence.slice(0, 160)}”), ` +
    `but no tool in this turn did that. What actually ran this turn: ${did}. ` +
    "Never describe an action as done unless a tool result says it was. Either call the right tool now to actually do it (if the user asked for it), " +
    "or rewrite your whole reply so it says exactly what happened and what didn't. Reply with the complete corrected message for the user."
  );
}

/**
 * Last resort if the corrected reply still claims something unbacked: drop
 * those sentences and say plainly what the turn's steps did.
 */
export function stripUnsupported(text: string, claims: UnsupportedClaim[], displays: string[]): string {
  const bad = new Set(claims.map((c) => c.sentence));
  const kept = sentences(text).filter((s) => !bad.has(s)).join(" ");
  const facts = displays.length ? `What actually happened: ${displays.join("; ")}.` : "Nothing was changed.";
  return [kept, facts].filter(Boolean).join("\n\n");
}

/** The reply when the model wrote no text: never a bare "Done." */
export function emptyReply(displays: string[], anyFailed: boolean): string {
  if (!displays.length) return "I didn't change anything.";
  return `${anyFailed ? "Not everything worked. " : ""}What happened: ${displays.join("; ")}.`;
}
