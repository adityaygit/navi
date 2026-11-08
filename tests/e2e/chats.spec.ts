import { test, expect, type Page } from "@playwright/test";
import { freshSetUpAccount } from "./helpers";

// Home is the chat: the conversation opens in the centre under Home's header.
// The sidebar starts new chats and lists recent ones (open, rename, delete);
// every chat has its own URL. Other pages show the same conversation in the
// Navi panel, with a way back to the full chat.

const SHOTS = process.env.CHAT_LAYOUT_SHOTS;

async function say(page: Page, text: string) {
  await page.getByLabel("Message Navi").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Navi is thinking…")).toBeHidden({ timeout: 30_000 });
}

const chatsList = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("list", { name: "Chats" });

test("Home is the chat; the sidebar starts, opens, renames and deletes chats", async ({ page }) => {
  await freshSetUpAccount(page, "chats-desktop@navi.test");
  await page.goto("/");
  const centre = page.getByRole("main");
  const convo = centre.getByRole("log", { name: "Conversation" });
  // Before any message Home looks as it always did, with the box at the bottom and no side panel.
  await expect(centre.getByRole("heading", { level: 1 })).toContainText(/Morning|Afternoon|Evening|Night/i);
  await expect(page.getByRole("complementary", { name: "Navi" })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-layout-home-before.png` });

  // The first message opens the conversation in the centre, names the chat, and gives it a URL.
  await say(page, "Packing list for the beach trip");
  await expect(page).toHaveURL(/\/\?c=[0-9a-f-]{36}$/);
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();
  await expect(centre.getByRole("heading", { level: 2, name: /Packing list for the beach trip/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Navi" })).toHaveCount(0);
  await expect(chatsList(page).getByRole("link", { name: "Packing list for the beach trip" })).toHaveAttribute("aria-current", "true");
  const firstUrl = page.url();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-layout-home-chatting.png` });

  // Reload keeps the chat.
  await page.reload();
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();

  // New chat: a blank chat in the centre, cursor in the box.
  await page.getByRole("link", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Message Navi")).toBeFocused();
  await expect(convo.getByText("Packing list for the beach trip")).toHaveCount(0);
  await say(page, "Draft my resignation letter");
  await expect(page).toHaveURL(/\/\?c=[0-9a-f-]{36}$/);
  await expect(convo.getByText("Packing list for the beach trip")).toHaveCount(0);
  await expect(chatsList(page).getByRole("link")).toHaveCount(2);
  // Newest first.
  await expect(chatsList(page).getByRole("link").first()).toHaveText("Draft my resignation letter");
  const secondUrl = page.url();

  // Open the first chat from the sidebar: its messages, not the second's.
  await chatsList(page).getByRole("link", { name: "Packing list for the beach trip" }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();
  await expect(convo.getByText("Draft my resignation letter")).toHaveCount(0);
  // Back/forward move between chats.
  await page.goBack();
  await expect(page).toHaveURL(secondUrl);
  await expect(convo.getByText("Draft my resignation letter")).toBeVisible();
  await page.goForward();
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();

  // Other pages show the same conversation in the panel, with a way back to the full chat.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks/);
  const panel = page.getByRole("complementary", { name: "Navi" });
  await expect(panel.getByText("Packing list for the beach trip").first()).toBeVisible();
  await expect(chatsList(page).getByRole("link", { name: "Packing list for the beach trip" })).toHaveAttribute("aria-current", "true");
  // A message in the panel is in the same chat as the centre.
  await panel.getByLabel("Message Navi").fill("Add sunscreen to the list");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Navi is thinking…")).toBeHidden({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-layout-tasks-panel.png` });
  await panel.getByRole("link", { name: "Back to chat" }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(convo.getByText("Add sunscreen to the list")).toBeVisible();
  await expect(convo.getByText("Packing list for the beach trip")).toBeVisible();

  // Rename from the row's ⋯ menu.
  await chatsList(page).getByRole("button", { name: "Options for Packing list for the beach trip" }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-layout-sidebar-menu.png` });
  await page.getByRole("button", { name: "Rename" }).click();
  await chatsList(page).getByLabel("Chat name").fill("Beach trip");
  await chatsList(page).getByLabel("Chat name").press("Enter");
  await expect(chatsList(page).getByRole("link", { name: "Beach trip" })).toBeVisible();
  await expect(centre.getByRole("heading", { level: 2, name: /Beach trip/ })).toBeVisible();

  // Delete it (after a confirm): its messages go, and a blank chat takes its place.
  await chatsList(page).getByRole("button", { name: "Options for Beach trip" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(chatsList(page).getByRole("link", { name: /Beach trip/ })).toHaveCount(0);
  await expect(convo.getByText("Add sunscreen to the list")).toHaveCount(0);

  // A deleted chat's link says so and offers a new chat.
  await page.goto(firstUrl);
  await expect(page.getByText("That chat doesn't exist anymore")).toBeVisible();

  // The old /chat page redirects to the chat on Home.
  await page.goto(`/chat?c=${secondUrl.split("c=")[1]}`);
  await expect(page).toHaveURL(secondUrl);
  await expect(convo.getByText("Draft my resignation letter")).toBeVisible();
});

test("a link in Navi's reply opens the page with a way back to the chat", async ({ page }) => {
  await freshSetUpAccount(page, "chats-link@navi.test");
  await page.goto("/");
  await say(page, "Hello there");
  await expect(page).toHaveURL(/\/\?c=[0-9a-f-]{36}$/);
  const chatUrl = page.url();
  // Stand in for a link in a reply (e.g. "See approvals in Activity"): any link inside the conversation.
  await page.getByRole("log", { name: "Conversation" }).evaluate((log) => {
    const a = document.createElement("a");
    a.href = "/activity";
    a.textContent = "Open Activity";
    log.appendChild(a);
  });
  await page.getByRole("link", { name: "Open Activity" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  const pill = page.getByRole("status").filter({ hasText: "Navi opened Activity" });
  await expect(pill).toBeVisible();
  await pill.getByRole("button", { name: "Back to chat" }).click();
  await expect(page).toHaveURL(chatUrl);
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Hello there")).toBeVisible();
  // Browser back from the page works the same way.
  await page.goForward();
  await expect(page).toHaveURL(/\/activity$/);
  await page.goBack();
  await expect(page).toHaveURL(chatUrl);
});
