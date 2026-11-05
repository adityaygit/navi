import { test, expect, type Page } from "@playwright/test";
import { freshSetUpAccount } from "./helpers";

// Several chats: start new ones, switch between them (each keeps its own
// messages), rename, delete. On phones the chat list is a panel behind a button.

async function say(page: Page, text: string) {
  await page.getByLabel("Message Navi").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Navi is thinking…")).toBeHidden({ timeout: 30_000 });
}

/** The chat list: always visible on desktop, opened from the "Chats" button on phones. */
async function chatList(page: Page, phone: boolean) {
  if (phone) {
    const toggle = page.locator('button[aria-controls="chat-list-panel"]');
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    return page.locator("#chat-list-panel");
  }
  return page.getByRole("complementary", { name: "Your chats" });
}

test("start, switch, rename and delete chats", async ({ page }, info) => {
  const phone = info.project.name === "iphone";
  await freshSetUpAccount(page, phone ? "chats-phone@navi.test" : "chats-desktop@navi.test");
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1, name: "New chat" })).toBeVisible();

  // First chat is created by its first message and named after it.
  await say(page, "Packing list for the beach trip");
  await expect(page).toHaveURL(/\/chat\?c=[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name: "Packing list for the beach trip" })).toBeVisible();
  const firstUrl = page.url();

  // A second, separate chat.
  let list = await chatList(page, phone);
  await list.getByRole("link", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New chat" })).toBeVisible();
  const convo = page.locator('[aria-label="Conversation"]');
  await expect(convo.getByText("Packing list for the beach trip")).toHaveCount(0);
  await say(page, "Draft my resignation letter");
  await expect(page.getByRole("heading", { level: 1, name: "Draft my resignation letter" })).toBeVisible();
  await expect(convo.getByText("Packing list for the beach trip")).toHaveCount(0);

  // Switch back: the first chat's messages are there, the second's aren't.
  list = await chatList(page, phone);
  await expect(list.getByRole("link")).toHaveCount(3); // New chat + two chats
  await list.getByRole("link", { name: /Packing list for the beach trip/ }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();
  await expect(convo.getByText("Draft my resignation letter")).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-chats.png`, fullPage: true });

  // Rename it.
  list = await chatList(page, phone);
  await list.getByRole("button", { name: "Rename Packing list for the beach trip" }).click();
  await list.getByLabel("Chat name").fill("Beach trip");
  await list.getByLabel("Chat name").press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Beach trip" })).toBeVisible();

  // Delete it: we land on the remaining chat.
  list = await chatList(page, phone);
  page.once("dialog", (d) => void d.accept());
  await list.getByRole("button", { name: "Delete Beach trip" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft my resignation letter" })).toBeVisible();
  list = await chatList(page, phone);
  await expect(list.getByRole("link", { name: /Beach trip/ })).toHaveCount(0);

  // A deleted chat's link says so and offers a new chat.
  await page.goto(firstUrl);
  await expect(page.getByText("That chat doesn't exist anymore")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "New chat" })).toBeVisible();
});
