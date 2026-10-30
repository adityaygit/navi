import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// Real-time voice, everything on Navi's side of the wire: fake microphone →
// audio worklet → 16 kHz PCM streamed over the Live API socket; transcripts on
// screen; a tool call executed by the real server against the real database;
// Navi's audio played back; barge-in; and the turn saved into the same chat
// history as text. The Gemini Live service itself is a stand-in here (no
// GEMINI_API_KEY in this environment), so the provider's own behaviour is not
// covered by this test.

/**
 * Stands in for Gemini Live: /api/voice/session answers as it would with a key
 * configured (pointing at the user's real conversation of `kind`), and the
 * Live API socket is served by the test. Register before loading the page.
 */
async function standInLiveApi(page: Page, userId: string, kind: "chat" | "onboarding") {
  let conversationId = "";
  const resumeHandles: (string | null)[] = [];
  await page.route("**/api/voice/session", async (route) => {
    const req = route.request().postDataJSON() as { probe?: boolean; resumeHandle?: string | null };
    if (!req.probe) resumeHandles.push(req.resumeHandle ?? null);
    if (kind === "chat") {
      const { data } = await admin.from("conversations").select("id").eq("user_id", userId).eq("kind", "chat").single();
      conversationId = data!.id as string;
    } else {
      const { data } = await admin.from("profiles").select("onboarding_conversation_id").eq("id", userId).single();
      conversationId = data!.onboarding_conversation_id as string;
    }
    await route.fulfill({ json: { ok: true, token: "auth_tokens/test-token", model: "gemini-3.8-live", config: { responseModalities: ["AUDIO"] }, conversationId } });
  });

  const seen = { setup: null as unknown, audioChunks: 0, toolResponse: null as unknown, sockets: 0, closed: false };
  let socket: WebSocketRoute | null = null;
  const send = (msg: unknown) => socket!.send(JSON.stringify(msg));
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    socket = ws;
    seen.sockets++;
    const mine = seen.sockets;
    ws.onClose(() => {
      if (mine === seen.sockets) seen.closed = true; // only the current socket counts
    });
    expect(ws.url()).toContain("BidiGenerateContentConstrained?access_token=auth_tokens/test-token");
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.setup) {
        seen.setup = msg.setup;
        send({ setupComplete: {} });
      } else if (msg.realtimeInput?.audio) {
        expect(msg.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
        seen.audioChunks++;
      } else if (msg.toolResponse) {
        seen.toolResponse = msg.toolResponse;
      }
    });
  });
  // The service dropping the connection unexpectedly.
  const drop = () => socket!.close({ code: 1011, reason: "Internal error" });
  return { seen, send, drop, resumeHandles, conversation: () => conversationId };
}

test.use({
  channel: "chromium",
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("voice streams the mic, runs tools for real, plays replies and saves the turn to shared history", async ({ page, context, baseURL }, info) => {
  await context.grantPermissions(["microphone"], { origin: baseURL! });
  const userId = await freshSetUpAccount(page, `voice-${info.project.name}@navi.test`);

  const { seen, send, drop, resumeHandles, conversation } = await standInLiveApi(page, userId, "chat");
  // Keep hold of every microphone track so the test can tell if it's really off.
  await page.addInitScript(() => {
    const w = window as unknown as { __mic: MediaStreamTrack[] };
    w.__mic = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await original(c);
      w.__mic.push(...stream.getAudioTracks());
      return stream;
    };
  });
  const micStates = () => page.evaluate(() => (window as unknown as { __mic: MediaStreamTrack[] }).__mic.map((t) => t.readyState));

  // WebSocket routes apply to pages loaded after they're registered.
  await page.goto("/chat");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  const voice = page.getByRole("region", { name: "Voice conversation" });
  await voice.getByRole("button", { name: "Start talking" }).click();
  await expect(voice.getByLabel("Microphone is on")).toBeVisible();

  // The microphone is really streaming PCM.
  await expect.poll(() => seen.audioChunks, { timeout: 15_000 }).toBeGreaterThan(5);
  expect(seen.setup).toMatchObject({ model: "models/gemini-3.8-live" });

  // Mute really stops sending microphone audio, and says so.
  await voice.getByRole("button", { name: "Mute mic" }).click();
  await expect(voice.getByRole("status").first()).toContainText("Muted");
  await expect(voice.getByLabel("Microphone is on")).toHaveCount(0);
  await page.waitForTimeout(300); // let chunks already in flight arrive
  const atMute = seen.audioChunks;
  await page.waitForTimeout(1000);
  expect(seen.audioChunks).toBe(atMute);
  await voice.getByRole("button", { name: "Unmute mic" }).click();
  await expect(voice.getByLabel("Microphone is on")).toBeVisible();
  await expect.poll(() => seen.audioChunks, { timeout: 10_000 }).toBeGreaterThan(atMute);

  // The user speaks; the model asks for a tool; the real server runs it.
  send({ serverContent: { inputTranscription: { text: "Add a task to call the dentist." } } });
  await expect(voice.getByText("Add a task to call the dentist.")).toBeVisible();
  // Without the user's quoted instruction, a direct create is refused and nothing changes.
  send({ toolCall: { functionCalls: [{ id: "call-0", name: "create_task", args: { title: "Call the dentist" } }] } });
  await expect.poll(() => seen.toolResponse, { timeout: 15_000 }).toBeTruthy();
  expect(seen.toolResponse).toMatchObject({ functionResponses: [{ id: "call-0", response: { output: { ok: false } } }] });
  seen.toolResponse = null;
  send({ toolCall: { functionCalls: [{ id: "call-1", name: "create_task", args: { title: "Call the dentist", priority: 2, user_command: "Add a task to call the dentist." } }] } });
  await expect.poll(() => seen.toolResponse, { timeout: 15_000 }).toBeTruthy();
  expect(seen.toolResponse).toMatchObject({ functionResponses: [{ id: "call-1", name: "create_task", response: { output: { ok: true } } }] });
  const { data: task } = await admin.from("tasks").select("title,priority").eq("user_id", userId).eq("title", "Call the dentist").single();
  expect(task).toEqual({ title: "Call the dentist", priority: 2 });
  // The service sending the same call again gets the same answer; it doesn't run twice.
  seen.toolResponse = null;
  send({ toolCall: { functionCalls: [{ id: "call-1", name: "create_task", args: { title: "Call the dentist", priority: 2, user_command: "Add a task to call the dentist." } }] } });
  await expect.poll(() => seen.toolResponse, { timeout: 15_000 }).toMatchObject({ functionResponses: [{ id: "call-1", response: { output: { ok: true } } }] });
  const { count: copies } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("title", "Call the dentist");
  expect(copies).toBe(1);

  // Navi answers out loud (24 kHz PCM) with a transcript.
  const pcm = Buffer.alloc(24000 * 2 * 0.5); // half a second of silence
  send({ serverContent: { outputTranscription: { text: "Done. I added “Call the dentist”." }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcm.toString("base64") } }] } } });
  await expect(voice.getByText("Done. I added “Call the dentist”.")).toBeVisible();
  send({ serverContent: { turnComplete: true } });

  // The turn lands in the same conversation as typed messages.
  await expect
    .poll(async () => {
      const { data } = await admin.from("messages").select("role,content,modality,tool_events").eq("conversation_id", conversation()).order("created_at");
      return data;
    }, { timeout: 15_000 })
    .toEqual([
      { role: "user", content: "Add a task to call the dentist.", modality: "voice", tool_events: [] },
      { role: "assistant", content: "Done. I added “Call the dentist”.", modality: "voice", tool_events: [expect.objectContaining({ name: "create_task", ok: false }), expect.objectContaining({ name: "create_task", ok: true })] },
    ]);

  // Barge-in: when the service reports an interruption, Navi stops speaking.
  // A longer reply, streamed the way the service does: many short audio chunks.
  send({ serverContent: { outputTranscription: { text: "Also, tomorrow you" } } });
  for (let i = 0; i < 30; i++) {
    send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(24000 * 2 * 0.1).toString("base64") } }] } } });
  }
  const status = voice.getByRole("status").first();
  await expect(status).toContainText("Navi is speaking");
  send({ serverContent: { interrupted: true } });
  await expect(status).toContainText("Listening");

  // One session the whole time: saving a turn must not hang up.
  expect(seen).toMatchObject({ sockets: 1, closed: false });

  // The service's session limit: it offers a resumption handle, then says it's
  // going away. Navi reconnects by itself, resuming the same conversation.
  send({ sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle-1" } });
  send({ goAway: { timeLeft: "5s" } });
  await expect.poll(() => seen.sockets, { timeout: 15_000 }).toBe(2);
  expect(resumeHandles).toEqual([null, "resume-handle-1"]);
  seen.closed = false;
  await expect(status).toContainText("Listening");

  // The connection drops unexpectedly: the microphone turns off and Navi says so.
  drop();
  await expect(status).toContainText("Connection lost");
  await expect(voice.getByText(/microphone is off; tap Reconnect/)).toBeVisible();
  await expect(voice.getByLabel("Microphone is on")).toHaveCount(0);
  await expect.poll(micStates).not.toContain("live");
  // Reconnect picks up where it left off, with the microphone back on.
  await voice.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => seen.sockets, { timeout: 15_000 }).toBe(3);
  await expect(status).toContainText("Listening");
  await expect(voice.getByLabel("Microphone is on")).toBeVisible();
  expect(await micStates()).toContain("live");
  seen.closed = false;

  // Back to text: ending voice hangs up, and the voice turn is in the chat history.
  await voice.getByRole("button", { name: "End voice" }).click();
  await expect.poll(() => seen.closed).toBe(true);
  await expect(voice.getByLabel("Microphone is on")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Add a task to call the dentist.")).toBeVisible();
  await expect(page.getByText(/Done\. I added “Call the dentist”\./)).toBeVisible();
});

test("setting Navi up by voice ends in the same reviewed setup as typing", async ({ page, context, baseURL }, info) => {
  await context.grantPermissions(["microphone"], { origin: baseURL! });
  const email = `voice-setup-${info.project.name}@navi.test`;
  await admin.from("allowed_emails").upsert({ email, note: "e2e" });
  const { data: users } = await admin.auth.admin.listUsers();
  const old = users.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id);
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const { data: after } = await admin.auth.admin.listUsers();
  const userId = after.users.find((u) => u.email === email)!.id;

  const { seen, send } = await standInLiveApi(page, userId, "onboarding");
  await page.reload();
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  await page.getByRole("region", { name: "Voice conversation" }).getByRole("button", { name: "Start talking" }).click();
  await expect.poll(() => seen.audioChunks, { timeout: 15_000 }).toBeGreaterThan(3);

  send({ serverContent: { inputTranscription: { text: "I'm in school and I have chess club Tuesdays at 3." } } });
  send({
    toolCall: {
      functionCalls: [
        {
          id: "p1",
          name: "propose_items",
          args: {
            batch: "onboarding",
            items: [
              { kind: "workspace", payload: { name: "School" }, ref_key: "ws_school", origin: "stated", confidence: 0.9 },
              { kind: "routine", payload: { title: "Chess club", days: [2], start_time: "15:00", duration_minutes: 60, is_fixed: true, workspace_ref: "ws_school" }, source_excerpt: "chess club Tuesdays at 3", origin: "stated", confidence: 0.9 },
            ],
          },
        },
      ],
    },
  });
  await expect.poll(() => seen.toolResponse, { timeout: 15_000 }).toMatchObject({ functionResponses: [{ id: "p1", response: { output: { ok: true } } }] });
  seen.toolResponse = null;
  send({ toolCall: { functionCalls: [{ id: "r1", name: "mark_onboarding_ready", args: { summary: "School and chess club" } }] } });
  await expect.poll(() => seen.toolResponse, { timeout: 15_000 }).toMatchObject({ functionResponses: [{ id: "r1", response: { output: { ok: true } } }] });

  // The page switches to review on its own; nothing is active until approved.
  await expect(page.getByRole("heading", { name: "Review your setup" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Chess club", { exact: true })).toBeVisible();
  const { count } = await admin.from("routines").select("id", { count: "exact", head: true }).eq("user_id", userId);
  expect(count).toBe(0);
  // Leaving the conversation for the review hangs up the microphone.
  await expect.poll(() => seen.closed).toBe(true);
  await page.getByRole("button", { name: /Activate \d+ items? and plan my week/ }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const { data: routine } = await admin.from("routines").select("title,days,start_time,workspaces(name)").eq("user_id", userId).single();
  expect(routine).toEqual({ title: "Chess club", days: [2], start_time: "15:00:00", workspaces: { name: "School" } });
});
