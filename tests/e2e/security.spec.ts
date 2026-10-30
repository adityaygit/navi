import { test, expect, type Page } from "@playwright/test";
import { admin, ensureAccount, PASSWORD, signInWithPassword } from "./helpers";

// Security review (session 3) fixes, checked in the production build:
// accounts can't be claimed from the sign-in page, sign-in redirects stay on
// this site, error text in URLs isn't shown, push subscriptions only accept
// real push services, and deleting an account needs its email.

const MAILPIT = "http://127.0.0.1:54324";

async function findUser(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email) ?? null;
}

async function removeUser(email: string) {
  const u = await findUser(email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

/** The newest sign-in link emailed to `email` by local Supabase (Mailpit). */
async function latestLink(email: string, after: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const list = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const fresh = list.messages.find((m) => Date.parse(m.Created) >= after - 1000);
    if (fresh) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string; Text: string };
      const link = (msg.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ?? msg.Text.match(/(http\S*\/auth\/v1\/verify\S*)/))?.[1];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No sign-in email for ${email}`);
}

async function signOut(page: Page) {
  await page.goto("/more");
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("an invited email can't be claimed from the sign-in page", async ({ page }, info) => {
  // Invited, but the owner hasn't created the account yet: an attacker who
  // knows the address tries to register it with their own password.
  const email = `claim-${info.project.name}@navi.test`;
  await admin.from("allowed_emails").upsert({ email, note: "e2e security" });
  await removeUser(email);
  await signInWithPassword(page, email);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/Wrong email or password/);
  await page.getByRole("button", { name: "Use an email link instead" }).click();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(/no Navi account for this email/i);
  expect(await findUser(email)).toBeNull();
  await expect(page).toHaveURL(/\/login/);
});

test("an account the owner created signs in by email link, then can add a password", async ({ page }, info) => {
  const email = `invitee-${info.project.name}@navi.test`;
  await admin.from("allowed_emails").upsert({ email, note: "e2e security" });
  await removeUser(email);
  // What scripts/allow-email.mjs add does: confirmed, no password, no email sent.
  const { data: made, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  expect(error).toBeNull();
  await admin.from("profiles").update({ onboarding_status: "skipped", timezone: "UTC" }).eq("id", made.user!.id);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  const sentAt = Date.now();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Check your email");
  await page.goto(await latestLink(email, sentAt));
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Password" });
  await section.getByLabel("New password", { exact: true }).fill("a-new-password-42");
  await section.getByLabel("Repeat new password").fill("a-new-password-42");
  await section.getByRole("button", { name: "Save password" }).click();
  await expect(section.getByRole("status")).toContainText("Password saved");

  await signOut(page);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-new-password-42");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("sign-in redirects stay on this site and URL error text is never shown", async ({ page, baseURL }, info) => {
  const email = `redirect-${info.project.name}@navi.test`;
  const userId = await ensureAccount(email, { fresh: true });
  await admin.from("profiles").update({ onboarding_status: "skipped", timezone: "UTC" }).eq("id", userId);

  // An attacker's message in the URL is replaced by a fixed one.
  await page.goto(`/login?error=${encodeURIComponent("Your account is locked. Call +1 555 0100.")}`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Sign-in didn't complete. Try again.");
  await expect(page.getByText(/555 0100/)).toHaveCount(0);

  for (const next of ["//evil.example/phish", "/\\evil.example", "/\t/evil.example", "https://evil.example/"]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/" || u.host !== new URL(baseURL!).host);
    expect(new URL(page.url()).origin, next).toBe(new URL(baseURL!).origin);
    await signOut(page);
  }
  // A same-site destination is kept.
  await page.goto(`/login?next=${encodeURIComponent("/tasks?view=all")}`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/tasks\?view=all$/);

  // The server-side callbacks don't redirect off-site or echo provider text either.
  const ctx = page.request;
  for (const path of [
    `/auth/callback?error_description=${encodeURIComponent("Call +1 555 0100")}`,
    `/auth/callback?code=not-a-real-code&next=${encodeURIComponent("//evil.example")}`,
    `/auth/confirm?token_hash=x&type=magiclink&next=${encodeURIComponent("/\\evil.example")}`,
  ]) {
    const res = await ctx.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBeGreaterThanOrEqual(300);
    const location = new URL(res.headers()["location"], baseURL);
    expect(location.origin, path).toBe(new URL(baseURL!).origin);
    expect(location.pathname, path).toBe("/login");
    expect(["provider", "link"]).toContain(location.searchParams.get("error"));
  }
});

test("push subscriptions only accept real push services; account deletion needs the email", async ({ page }, info) => {
  const email = `ssrf-${info.project.name}@navi.test`;
  const userId = await ensureAccount(email, { fresh: true });
  await admin.from("profiles").update({ onboarding_status: "skipped", timezone: "UTC" }).eq("id", userId);
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/$/);
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  for (const endpoint of ["https://169.254.169.254/latest/meta-data/", "http://127.0.0.1:54321/rest/v1/", "https://internal.example/hook"]) {
    const res = await page.request.post("/api/push/subscribe", { data: { endpoint, keys } });
    expect(res.status(), endpoint).toBe(400);
  }
  const good = "https://fcm.googleapis.com/fcm/send/e2e-security-test";
  expect((await page.request.post("/api/push/subscribe", { data: { endpoint: good, keys } })).status()).toBe(200);
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint").eq("user_id", userId);
  expect(subs).toEqual([{ endpoint: good }]);
  await page.request.delete("/api/push/subscribe", { data: { endpoint: good } });

  // A request with only the typed DELETE (e.g. forged or stray) deletes nothing.
  const res = await page.request.delete("/api/account", { data: { confirm: "DELETE", email: "someone-else@navi.test" } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/doesn't match/);
  expect((await admin.auth.admin.getUserById(userId)).data.user).not.toBeNull();
  expect((await page.request.delete("/api/account", { data: { confirm: "DELETE" } })).status()).toBe(400);
  expect((await admin.auth.admin.getUserById(userId)).data.user).not.toBeNull();
});
