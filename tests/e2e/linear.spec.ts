import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { admin, freshSetUpAccount } from "./helpers";

// Settings → Integrations → Linear, the start of the OAuth flow, the CSRF
// check on the callback, and how an imported Linear task looks and behaves.
// Linear itself isn't reachable from tests: the flow is checked up to the
// redirect to linear.app. When the server has no Linear settings (CI), the
// row says so and the connect steps are skipped.

test("Linear: connect flow start, forged callback refused, imported task is read-only where Linear owns it", async ({ page }) => {
  const userId = await freshSetUpAccount(page, "e2e-linear@navi.test");

  await page.goto("/settings#services");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  const connectLink = page.getByRole("link", { name: "Connect Linear" });
  const configured = await connectLink.isVisible();
  if (!configured) {
    await expect(page.getByText("the server needs its Linear settings")).toBeVisible();
  } else {
    // Connect → Linear's consent screen, with a state and PKCE challenge; the browser keeps an httpOnly state cookie.
    const res = await page.request.get("/api/integrations/linear/connect", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const to = new URL(res.headers()["location"]);
    expect(to.origin + to.pathname).toBe("https://linear.app/oauth/authorize");
    expect(to.searchParams.get("scope")).toBe("read");
    expect(to.searchParams.get("state")?.length).toBeGreaterThan(30);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.has("client_secret")).toBe(false);
    expect(res.headers()["set-cookie"]).toMatch(/navi_linear_oauth=.*HttpOnly/i);

    // A callback whose state doesn't match is refused, and says so plainly.
    await page.goto("/api/integrations/linear/callback?code=attacker-code&state=forged");
    await expect(page).toHaveURL(/\/settings\?linear=state/);
    await expect(page.getByRole("status").filter({ hasText: "expired or didn't match" })).toBeVisible();
  }

  // An imported task (as the sync writes it) with a live connection.
  const { data: conn } = await admin
    .from("integration_connections")
    .insert({ user_id: userId, provider: "linear", external_org_id: "e2e-org", external_org_name: "Acme", external_user_id: "u1", external_user_name: "me", last_sync_ok_at: new Date().toISOString(), last_sync_stats: { imported: 1, updated: 0, closed: 0, detached: 0, open: 1, truncated: false } })
    .select("id")
    .single();
  const { data: task } = await admin
    .from("tasks")
    .insert({
      user_id: userId,
      title: "Fix login redirect",
      priority: 2,
      status: "in_progress",
      source: "linear",
      external_source: "linear",
      external_id: "e2e-issue-1",
      external_url: "https://linear.app/acme/issue/ENG-42",
      external_connection_id: conn!.id,
      external_data: { identifier: "ENG-42", state_name: "In Progress", state_type: "started", priority_label: "High", org_id: "e2e-org" },
    })
    .select("id")
    .single();

  await page.goto("/settings#services");
  await expect(page.getByText("Linear · Acme")).toBeVisible();
  await expect(page.getByText(/read-only · synced .* · 1 open issue/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("#services").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Anytime" }).or(page.getByRole("link", { name: "Anytime" })).or(page.getByRole("tab", { name: "Anytime" })).first().click();
  await expect(page.getByText("ENG-42")).toBeVisible();
  await page.goto(`/tasks?open=${task!.id}`);
  const card = page.getByRole("group", { name: "Task: Fix login redirect" });
  await expect(card.getByText("From Linear · ENG-42")).toBeVisible();
  await expect(card.getByRole("link", { name: /Open in Linear/ })).toHaveAttribute("href", "https://linear.app/acme/issue/ENG-42");
  await expect(card.getByLabel("Title")).toHaveAttribute("readonly", "");
  await expect(card.getByRole("button", { name: "Delete task" })).toHaveCount(0);
  // Planning stays Navi's: the estimate can change.
  await card.getByRole("button", { name: "More details" }).click();
  await expect(card.getByLabel("Due")).toBeDisabled();
  await card.getByRole("button", { name: "More time" }).click();
  await expect.poll(async () => (await admin.from("tasks").select("estimate_minutes").eq("id", task!.id).single()).data?.estimate_minutes).toBe(15);
});
