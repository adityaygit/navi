import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Automated WCAG 2.1 A/AA checks (axe) on every main page, with real data on
// screen. Automated checks catch a subset of issues; they don't replace a
// manual screen-reader pass.

config({ path: ".env.local", quiet: true });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const PAGES = ["/", "/chat", "/inbox", "/planner", "/tasks", "/projects", "/insights", "/memory", "/activity", "/settings", "/more"];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const problems = results.violations.map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
  return problems;
}

test("main pages have no automatically detectable WCAG A/AA violations", async ({ page }, info) => {
  const email = `a11y-${info.project.name}@navi.test`;
  await admin.from("allowed_emails").upsert({ email, note: "e2e a11y spec" });
  const { data } = await admin.auth.admin.listUsers();
  const old = data.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id);

  const problems: string[] = [];
  // Record any Content-Security-Policy violation on every page visited.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const cspViolations = async (label: string) => {
    const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    return v.map((x) => `${label}: CSP blocked ${x}`);
  };
  await page.goto("/login");
  problems.push(...(await audit(page, "/login")));
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  problems.push(...(await audit(page, "/onboarding")));

  const { data: after } = await admin.auth.admin.listUsers();
  const userId = after.users.find((u) => u.email === email)!.id;
  await admin.from("profiles").update({ onboarding_status: "completed", timezone: "UTC", availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] }).eq("id", userId);
  const { data: ws } = await admin.from("workspaces").insert({ user_id: userId, name: "School" }).select("id").single();
  // Separate inserts: a bulk insert sends NULL for keys a row leaves out.
  for (const row of [
    { title: "Read chapter 4", workspace_id: ws!.id, due_at: new Date(Date.now() + 86_400_000).toISOString(), estimate_minutes: 30 },
    { title: "Email coach", priority: 1 },
  ]) {
    const { error } = await admin.from("tasks").insert({ user_id: userId, ...row });
    expect(error).toBeNull();
  }
  await admin.from("memories").insert({ user_id: userId, kind: "behavioral", content: "Tends to underestimate essays", origin: "inferred", confidence: 0.6 });
  await admin.from("proposals").insert({ user_id: userId, kind: "task", payload: { title: "Buy cleats" }, source_excerpt: "buy cleats", origin: "inferred", confidence: 0.5 });
  await admin.from("approvals").insert({ user_id: userId, action_type: "external.gmail.send", summary: "Email coach about Saturday", details: { to: "coach@example.com" }, idempotency_key: `a11y-${Date.now()}:1` });

  await page.goto("/");
  await page.getByRole("button", { name: "Re-plan today" }).click();
  await expect(page.getByText("Read chapter 4").first()).toBeVisible();
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    problems.push(...(await audit(page, path)), ...(await cspViolations(path)));
  }
  // The voice audio worklet must load under the CSP.
  const worklet = await page.evaluate(async () => {
    try {
      await new AudioContext().audioWorklet.addModule("/pcm-worklet.js");
      return "ok";
    } catch (e) {
      return String(e);
    }
  });
  if (worklet !== "ok") problems.push(`voice worklet: ${worklet}`);
  // Dark theme uses different color tokens; check contrast there as well.
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/inbox", "/memory", "/activity", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    problems.push(...(await audit(page, `${path} (dark)`)));
  }
  await page.emulateMedia({ colorScheme: "light" });
  // Dialogs too.
  await page.goto("/");
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  problems.push(...(await audit(page, "capture dialog")));

  expect(problems, problems.join("\n")).toEqual([]);
});
