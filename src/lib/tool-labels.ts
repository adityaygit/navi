import { READ_ONLY_TOOLS } from "./tool-names";

// How Navi's tool calls read to people: what it is doing while a step runs
// ("Adding task"), what it did once it finished ("Added task"), and for the
// read-only tools what it looked at, so several reads collapse into one quiet
// line ("Looked at your plan and inbox"). Shared by the server (stream events)
// and the chat UI (saved messages).

type Label = { doing: string; done: string; looksAt?: string };

const LABELS: Record<string, Label> = {
  get_overview: { doing: "Looking at your plan", done: "Looked at your plan", looksAt: "your plan" },
  get_plan: { doing: "Checking your schedule", done: "Checked your schedule", looksAt: "your schedule" },
  get_inbox: { doing: "Checking your inbox", done: "Checked your inbox", looksAt: "your inbox" },
  get_review: { doing: "Looking at how it went", done: "Looked at how it went", looksAt: "how it went" },
  search_items: { doing: "Searching your things", done: "Searched your things", looksAt: "your things" },
  recall: { doing: "Checking what I remember", done: "Checked what I remember", looksAt: "what I remember" },
  propose_items: { doing: "Adding to your review inbox", done: "Added to review inbox" },
  create_task: { doing: "Adding task", done: "Added task" },
  update_task: { doing: "Updating task", done: "Updated task" },
  complete_task: { doing: "Marking it done", done: "Marked done" },
  update_item: { doing: "Updating", done: "Updated" },
  plan_day: { doing: "Planning your day", done: "Planned your day" },
  plan_week: { doing: "Planning your week", done: "Planned your week" },
  recover_plan: { doing: "Reworking your plan", done: "Reworked your plan" },
  remember: { doing: "Saving to memory", done: "Saved to memory" },
  update_settings: { doing: "Updating settings", done: "Updated settings" },
  request_external_action: { doing: "Asking for your OK", done: "Asked for your OK" },
  mark_onboarding_ready: { doing: "Getting your setup ready", done: "Setup ready" },
};

function humanize(name: string) {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Working";
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.includes(name);
}

/** While the step runs: "Adding task". */
export function stepDoing(name: string): string {
  return LABELS[name]?.doing ?? humanize(name);
}

/** After it finished: "Added task", or "Couldn't add task" when it failed. */
export function stepDone(name: string, ok = true): string {
  const label = LABELS[name];
  if (ok) return label?.done ?? humanize(name);
  const doing = label?.doing ?? humanize(name);
  const [first, ...rest] = doing.split(" ");
  const base = /ing$/i.test(first) ? (BASE[first.toLowerCase()] ?? first.toLowerCase().replace(/ing$/, "")) : first.toLowerCase();
  return ["Couldn't", base, ...rest].join(" ");
}

const BASE: Record<string, string> = { adding: "add", planning: "plan", getting: "get", saving: "save", updating: "update", marking: "mark", asking: "ask", reworking: "rework", checking: "check", looking: "look", searching: "search" };

/**
 * One quiet line for a run of read-only steps: "Looking at your plan and inbox…"
 * while one is still running, "Looked at your plan and inbox" once all are done.
 */
export function readStepsLine(names: string[], running: boolean): string {
  const things = [...new Set(names.map((n) => LABELS[n]?.looksAt ?? humanize(n).toLowerCase()))].map((t, i) => (i > 0 ? t.replace(/^your /, "") : t));
  const list = things.length <= 1 ? (things[0] ?? "your plan") : `${things.slice(0, -1).join(", ")} and ${things[things.length - 1]}`;
  return running ? `Looking at ${list}…` : `Looked at ${list}`;
}
