import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// Accepted inbox notes land somewhere you can see them: Notes (under More),
// where you can read, edit, add and delete your own notes.

test("an accepted inbox note shows in Notes, and notes can be added, edited and deleted", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `notes-${info.project.name}@navi.test`);
  await page.goto("/more");
  await page.getByRole("main").getByRole("link", { name: "Notes" }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByText("No notes yet.")).toBeVisible();

  await admin.from("proposals").insert({ user_id: userId, kind: "note", payload: { title: "Wifi at grandma's", body: "Network BlueHouse, password on the fridge" }, source_excerpt: "grandma wifi is bluehouse, password on the fridge", origin: "stated", confidence: 0.9 });
  await page.goto("/inbox");
  const card = page.getByRole("article", { name: "Note: Wifi at grandma's" });
  await expect(card.getByText("Accepting saves it in Notes")).toBeVisible();
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card).toHaveCount(0);

  await page.goto("/notes");
  const note = page.getByRole("listitem", { name: "Note: Wifi at grandma's" });
  await expect(note.getByText("Network BlueHouse, password on the fridge")).toBeVisible();
  await expect(note.getByText(/From your inbox · saved/)).toBeVisible();

  // Edit it; the change is saved (survives a reload).
  await note.getByRole("button", { name: "Edit" }).click();
  await note.getByLabel("Note", { exact: true }).fill("Network BlueHouse, password is taped inside the cupboard");
  await note.getByRole("button", { name: "Save note" }).click();
  // The editor closes once the save has finished; reloading earlier can beat it.
  await expect(note.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("password is taped inside the cupboard")).toBeVisible();

  // Add one by hand.
  await page.getByRole("button", { name: "+ New note" }).click();
  const form = page.getByRole("form", { name: "New note" });
  await form.getByLabel("Note", { exact: true }).fill("Bike lock code 4821");
  await form.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("listitem", { name: "Note: Bike lock code 4821" })).toBeVisible();
  const { data } = await admin.from("notes").select("title,body,source").eq("user_id", userId).order("created_at");
  expect(data).toEqual([
    { title: "Wifi at grandma's", body: "Network BlueHouse, password is taped inside the cupboard", source: "capture" },
    { title: null, body: "Bike lock code 4821", source: "user" },
  ]);

  // Delete both (after confirming); the empty state comes back.
  page.on("dialog", (d) => d.accept());
  for (const name of ["Note: Bike lock code 4821", "Note: Wifi at grandma's"]) {
    await page.getByRole("listitem", { name }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("listitem", { name })).toHaveCount(0);
  }
  await expect(page.getByText("No notes yet.")).toBeVisible();
  const { count } = await admin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);
});
