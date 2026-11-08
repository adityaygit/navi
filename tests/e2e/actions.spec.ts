import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { admin, freshSetUpAccount } from "./helpers";

// Inline action cards in the chat, in a real browser with the development
// simulator: low-risk requests run at once with Undo; with "ask me first" a
// request becomes a card that can be changed by talking, approved (once, even
// when tapped twice), declined, and survives reloads; a failing action says so.

async function say(page: Page, text: string) {
  await page.getByLabel("Message Navi").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Navi is thinking…")).toBeHidden({ timeout: 30_000 });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `[${v.impact}] ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

const tasksTitled = async (userId: string, title: string) => (await admin.from("tasks").select("id,status,estimate_minutes").eq("user_id", userId).eq("title", title)).data ?? [];

test("ask first: change by talking, approve once, undo, decline, reload", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `actions-ask-${info.project.name}@navi.test`);
  await admin.from("profiles").update({ preferences: { autonomy: "ask" } }).eq("id", userId);
  await page.goto("/");
  const log = page.getByRole("log", { name: "Conversation" });

  await say(page, "add a task to call the dentist tomorrow");
  const card = log.getByRole("group", { name: "Create task: call the dentist" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Needs your OK")).toBeVisible();
  await expect(card.getByText("Due")).toBeVisible();
  await expect(card.getByText("you chose to approve every change", { exact: false })).toBeVisible();
  expect(await tasksTitled(userId, "call the dentist")).toHaveLength(0);

  // Changing it by talking updates the same card, now under the newest reply; the old mention shrinks to a line.
  await say(page, "make it 30 minutes instead");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Updated")).toBeVisible();
  await expect(card.getByText("30 min")).toBeVisible();
  await expect(log.getByText("Create task “call the dentist”: waiting for your OK below")).toBeVisible();

  // Survives a reload exactly as it was.
  await page.reload();
  await expect(card.getByText("30 min")).toBeVisible();
  if (info.project.name === "desktop") expect(await axe(page)).toEqual([]);

  // Two taps before the page can react: the server runs it once.
  await card.getByRole("button", { name: "Approve" }).evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(card.getByText("Created task “call the dentist”", { exact: false })).toBeVisible();
  const made = await tasksTitled(userId, "call the dentist");
  expect(made).toHaveLength(1);
  expect(made[0].estimate_minutes).toBe(30);

  // The result stays after a reload, with Undo.
  await page.reload();
  await expect(card.getByText("Created task “call the dentist”", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Undone")).toBeVisible();
  expect(await tasksTitled(userId, "call the dentist")).toHaveLength(0);

  // A second action in the same chat is its own card; Decline leaves things as they were.
  await admin.from("tasks").insert({ user_id: userId, title: "Laundry" });
  await say(page, "cancel laundry");
  const cancel = log.getByRole("group", { name: "Cancel task: Laundry" });
  await expect(cancel.getByText("it cancels a task", { exact: false })).toBeVisible();
  await cancel.getByRole("button", { name: "Decline" }).click();
  await expect(cancel.getByText("Declined. I left “Laundry” as it was.")).toBeVisible();
  expect((await tasksTitled(userId, "Laundry"))[0].status).toBe("todo");
  await page.reload();
  await expect(cancel.getByText("Declined. I left “Laundry” as it was.")).toBeVisible();
  if (info.project.name === "desktop") expect(await axe(page)).toEqual([]);
});

test("low-risk requests run at once and can be undone from the reply", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `actions-auto-${info.project.name}@navi.test`);
  await page.goto("/");
  const log = page.getByRole("log", { name: "Conversation" });
  await say(page, "add a task to water the plants");
  const row = log.locator("li", { hasText: "Added “water the plants”" });
  await expect(row).toBeVisible();
  await expect(log.getByRole("group")).toHaveCount(0); // no card, no confirmation step
  expect(await tasksTitled(userId, "water the plants")).toHaveLength(1);
  await page.reload();
  await row.getByRole("button", { name: "Undo" }).click();
  await expect(row.getByText("Undone")).toBeVisible();
  expect(await tasksTitled(userId, "water the plants")).toHaveLength(0);
  await page.reload();
  await expect(row.getByText("Undone")).toBeVisible();
  // Activity keeps the record of what Navi did on its own.
  await page.goto("/activity");
  await expect(page.getByText("Undid: Created task “water the plants”")).toBeVisible();
});

test("a failing or expired action says so honestly", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `actions-fail-${info.project.name}@navi.test`);
  // A conversation where Navi asked to send an email (no mail service is connected) and an older request that expired.
  const { data: conv } = await admin.from("conversations").insert({ user_id: userId, kind: "chat", title: "Coach" }).select("id").single();
  const { data: email } = await admin
    .from("approvals")
    .insert({ user_id: userId, action_type: "external.gmail.send", summary: "Email coach@example.com: I'll be late Saturday", details: { to: "coach@example.com" }, idempotency_key: `e2e-mail-${Date.now()}`, conversation_id: conv!.id })
    .select("id")
    .single();
  const { data: old } = await admin
    .from("approvals")
    .insert({ user_id: userId, action_type: "external.gmail.send", summary: "Email the team the slides", details: { to: "team@example.com" }, idempotency_key: `e2e-old-${Date.now()}`, conversation_id: conv!.id, expires_at: new Date(Date.now() - 60_000).toISOString() })
    .select("id")
    .single();
  await admin.from("messages").insert({
    user_id: userId,
    conversation_id: conv!.id,
    role: "assistant",
    content: "That needs your OK first.",
    modality: "voice",
    tool_events: [
      { name: "request_external_action", ok: true, summary: "Waiting", action_id: old!.id },
      { name: "request_external_action", ok: true, summary: "Waiting", action_id: email!.id },
    ],
  });
  await page.goto(`/?c=${conv!.id}`);
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Expired, so nothing was done.", { exact: false })).toBeVisible();
  const card = log.getByRole("group", { name: /Gmail send: Email coach@example.com/ });
  await expect(card.getByText("This reaches outside Navi", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Didn't go through: That service isn't connected, so nothing was sent or changed.")).toBeVisible();
  await expect(card.getByText("Created", { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(card.getByText("Didn't go through", { exact: false })).toBeVisible();
});
