// The constraint-first planner (v2) is switched on per account with
// profiles.preferences.planner_v2 = true (default off: the old planner runs
// exactly as before). Its two tunable defaults, set by talking to Navi or in
// Settings: how much free time flexible work may fill (D7, 70%) and whether
// Navi may plan in awake time nobody told it about, as a stated assumption
// (D1, on).

export type PlanningPrefs = { v2: boolean; loadCap: number; assumeFreeTime: boolean };

function prefs(preferences: unknown): Record<string, unknown> {
  return preferences && typeof preferences === "object" ? (preferences as Record<string, unknown>) : {};
}

export function plannerV2(preferences: unknown): boolean {
  return prefs(preferences).planner_v2 === true;
}

export function planningPrefs(preferences: unknown): PlanningPrefs {
  const p = prefs(preferences);
  const cap = typeof p.plan_load_cap === "number" && p.plan_load_cap >= 0.1 && p.plan_load_cap <= 1 ? p.plan_load_cap : 0.7;
  return { v2: p.planner_v2 === true, loadCap: cap, assumeFreeTime: p.assume_free_time !== false };
}
