// Setup on the phone (M6 step 5): GET /api/m/welcome and the steps under it.
// The same steps and rules as the web's /welcome (src/server/domain/welcome.ts).
// Types only.

import type { MChatHistory, MOnboardingStatus, MProposal } from "./mobile-api-types";

export type MWelcomeStep = "hello" | "basics" | "talk" | "review" | "notify" | "plan";

/** GET /api/m/welcome */
export type MWelcome = {
  /** The screen to show; null: nothing left to do (go home). */
  step: MWelcomeStep | null;
  status: MOnboardingStatus;
  firstName: string | null;
  /** Prefilled for the basics; `timezone` is the account's (the app offers the phone's). */
  basics: { name: string; timezone: string; wake: string; bed: string };
  /** Things Navi has picked up while talking, not decided yet. */
  picked: number;
  /** When Navi checks in: morning at wake-up, the evening review, quiet from bedtime. */
  checkIn: { morning: string; evening: string; quietFrom: string | null };
};

/** GET /api/m/welcome/talk — the setup conversation and what it picked up so far. */
export type MWelcomeTalk = MChatHistory & { proposals: MProposal[] };

/** POST /api/m/welcome/step */
export type MWelcomeStepSave = { step: MWelcomeStep | "done" };
/** POST /api/m/welcome/basics. Then Talk it through goes on to talk; quick setup calls complete with nothing chosen. */
export type MWelcomeBasics = { name: string; timezone: string; wake: string; bed: string };
/** POST /api/m/welcome/complete — turn on the chosen items (none for quick setup) and build the first plan. */
export type MWelcomeComplete = { acceptIds: string[] };
export type MWelcomeCompleted = { accepted: number; failed: { id: string; error?: string }[]; plannedBlocks: number };
