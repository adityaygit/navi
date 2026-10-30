import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { assertLocalSupabase } from "../local-guard";

config({ path: ".env.local", quiet: true });
assertLocalSupabase();
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function resetAccount(email: string) {
  const { data } = await admin.auth.admin.listUsers();
  const u = data.users.find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Lets a test run on its own: skips the setup conversation for an existing account. */
async function signInSetUp(page: Page, email: string) {
  await signIn(page, email);
  await page.waitForURL(/\/(onboarding)?$/);
  const { data } = await admin.auth.admin.listUsers();
  const u = data.users.find((x) => x.email === email)!;
  const { data: p } = await admin.from("profiles").select("onboarding_status").eq("id", u.id).single();
  if (!["completed", "skipped"].includes(p!.onboarding_status)) {
    await admin.from("profiles").update({ onboarding_status: "skipped" }).eq("id", u.id);
    await page.goto("/");
  }
  await expect(page).toHaveURL(/\/$/);
}

async function say(page: Page, text: string) {
  const box = page.getByLabel("Message Navi");
  await box.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Navi is thinking…")).toBeHidden({ timeout: 30_000 });
}

test("onboarding conversation → reviewed setup → plan → capture → inbox → task", async ({ page }, info) => {
  const email = info.project.name === "iphone" ? "alice@navi.test" : "dev@navi.test";
  await resetAccount(email);
  await signIn(page, email);

  // First run lands in the conversational setup, not a form wizard.
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Let's set up Navi" })).toBeVisible();
  await expect(page.getByText(/rule-based simulator, not a real AI model/)).toBeVisible();
  await say(page, "hi");
  await expect(page.getByText(/main areas of your life/)).toBeVisible();
  await say(page, "I'm in school and work on a startup. For my startup I'm working on an app called Tally. My goal is to get an A in chemistry class. I need to finish my history essay by friday and email investors tomorrow.");
  await say(page, "I have soccer practice mon and wed at 4pm. I go to the gym every morning at 7.");
  await say(page, "I'm free after 6pm on weekdays and free from 10am to 2pm on weekends. Quiet 10pm to 7am. That's it.");

  // Review screen: inferred vs stated is labelled; approve and activate.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Review your setup" })).toBeVisible();
  await expect(page.getByText("Navi inferred").first()).toBeVisible();
  await expect(page.getByText("You said this").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Goals & projects" })).toBeVisible();
  await expect(page.getByText("Get an A in chemistry class", { exact: true })).toBeVisible();
  await expect(page.getByText("Go to the gym", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-review.png`, fullPage: true });
  await page.getByRole("button", { name: /Activate \d+ items? and plan my week/ }).click();

  // Populated dashboard with real data.
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Today's plan" })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-today.png`, fullPage: true });
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "School" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Startups" })).toBeVisible();
  await expect(page.getByText("Tally").first()).toBeVisible();
  await expect(page.getByText("Get an A in chemistry class").first()).toBeVisible();
  await page.goto("/planner");
  await expect(page.getByText(/Soccer practice/i).first()).toBeVisible();

  // Capture a brain dump → review inbox → accept → becomes a real task.
  await page.goto("/");
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  await page.getByLabel("What's on your mind?").fill("buy new cleats tomorrow. text coach about saturday");
  await page.getByRole("dialog").getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText("Captured. Review it in your inbox.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("/inbox");
  const card = page.getByRole("article", { name: /cleats/i });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card).toBeHidden({ timeout: 15_000 });
  await page.goto("/tasks");
  await expect(page.getByText(/Buy new cleats/i)).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-tasks.png`, fullPage: true });

  // Chat can operate the same system: plan the day.
  await page.goto("/chat");
  await say(page, "plan my day");
  await expect(page.getByText(/Planned \d{4}-\d{2}-\d{2}/).first()).toBeVisible();
});

test("offline capture queues locally and syncs on reconnect", async ({ page, context }, info) => {
  const email = info.project.name === "iphone" ? "alice@navi.test" : "dev@navi.test";
  await signInSetUp(page, email);
  // Let the page hydrate and load its scripts before the network goes away.
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  await page.getByLabel("What's on your mind?").fill("offline idea: reorganize closet");
  await page.getByRole("dialog").getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();
  await expect(page.getByText(/Waiting to sync \(1\)/)).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Waiting to sync/)).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("/inbox");
  await expect(page.getByText(/reorganize closet/i).first()).toBeVisible();
});

test("voice says plainly when real-time voice isn't available and offers basic voice", async ({ page }, info) => {
  test.skip(!!process.env.GEMINI_API_KEY, "Real-time voice is configured; this checks the fallback path");
  const email = info.project.name === "iphone" ? "alice@navi.test" : "dev@navi.test";
  await signInSetUp(page, email);
  await page.goto("/chat");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  const voice = page.getByRole("region", { name: "Voice conversation" });
  await expect(voice.getByText(/microphone turns on only after you tap/i)).toBeVisible();
  await expect(voice.getByLabel("Microphone is on")).toHaveCount(0);
  await voice.getByRole("button", { name: "Start talking" }).click();
  await expect(voice.getByText(/Real-time voice isn't available .*Using basic voice/)).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-voice-fallback.png`, fullPage: true });
});

test("dictated capture keeps the spoken words and is marked as voice", async ({ page }, info) => {
  // Stand-in for the browser's speech service: "hears" one phrase, then stops.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "en-US"; interimResults = false; continuous = false;
      onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "renew library card by saturday" }, isFinal: true, length: 1 }] });
          this.onend?.();
        }, 100);
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
    w.SpeechRecognition = FakeRecognition; // newer Chromium ships the unprefixed name too
    w.webkitSpeechRecognition = FakeRecognition;
  });
  const email = info.project.name === "iphone" ? "alice@navi.test" : "dev@navi.test";
  await signInSetUp(page, email);
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  await page.getByRole("button", { name: "Dictate" }).click();
  await expect(page.getByLabel("What's on your mind?")).toHaveValue("renew library card by saturday");
  await page.getByRole("dialog").getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText("Captured. Review it in your inbox.")).toBeVisible({ timeout: 30_000 });
  const { data } = await admin.from("captures").select("source,raw_text").eq("raw_text", "renew library card by saturday").order("created_at", { ascending: false }).limit(1).single();
  expect(data!.source).toBe("voice");
  await page.goto("/inbox");
  await expect(page.getByText(/renew library card/i).first()).toBeVisible();
});
