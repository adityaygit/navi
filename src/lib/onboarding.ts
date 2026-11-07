import type { Profile } from "./types";

/**
 * Setup (onboarding) state, shared by the app layout's gate and /welcome.
 * Unfinished setup sends every app page to /welcome; a person who chose
 * "Do this later" (skipped) uses the app normally and can resume any time.
 */
export const WELCOME_STEPS = ["hello", "basics", "talk", "review", "notify", "plan"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export function needsOnboarding(status: Profile["onboarding_status"]): boolean {
  return status === "not_started" || status === "in_progress" || status === "reviewing";
}

/** App pages an unfinished person may still open (everything else goes to /welcome). */
export function onboardingAllowed(path: string): boolean {
  return path === "/settings" || path.startsWith("/settings/");
}

const isStep = (v: unknown): v is WelcomeStep => typeof v === "string" && (WELCOME_STEPS as readonly string[]).includes(v);

/**
 * The step to show, or null when there is nothing left to do here (go Home).
 * The saved step (profiles.preferences.onboarding_step) wins where it fits the
 * status, so closing the tab and coming back lands on the same screen, on any
 * device. After activation (completed) only the last two steps remain.
 */
export function resumeStep(status: Profile["onboarding_status"], saved: unknown): WelcomeStep | null {
  if (status === "completed") return saved === "notify" || saved === "plan" ? saved : null;
  if (status === "reviewing") return "review";
  if (isStep(saved) && saved !== "review" && saved !== "notify" && saved !== "plan") return saved;
  return status === "in_progress" ? "talk" : "hello";
}
