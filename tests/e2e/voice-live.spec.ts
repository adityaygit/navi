import { test, expect, type WebSocketRoute } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// Real-time voice, everything on Navi's side of the wire: fake microphone →
// audio worklet → 16 kHz PCM streamed over the Live API socket; transcripts on
// screen; a tool call executed by the real server against the real database;
// Navi's audio played back; barge-in; and the turn saved into the same chat
// history as text. The Gemini Live service itself is a stand-in here (no
// GEMINI_API_KEY in this environment), so the provider's own behaviour is not
// covered by this test.

test.use({
  channel: "chromium",
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("voice streams the mic, runs tools for real, plays replies and saves the turn to shared history", async ({ page, context, baseURL }, info) => {
  await context.grantPermissions(["microphone"], { origin: baseURL! });
  const userId = await freshSetUpAccount(page, `voice-${info.project.name}@navi.test`);

  // Session start: what /api/voice/session returns once a Gemini key is
  // configured, pointing at the chat conversation that text and voice share.
  let conversationId = "";
  await page.route("**/api/voice/session", async (route) => {
    const { data: conv } = await admin.from("conversations").select("id").eq("user_id", userId).eq("kind", "chat").single();
    conversationId = conv!.id as string;
    await route.fulfill({ json: { ok: true, token: "auth_tokens/test-token", model: "gemini-3.8-live", config: { responseModalities: ["AUDIO"] }, conversationId } });
  });

  // Stand-in for the Gemini Live socket.
  const seen = { setup: null as unknown, audioChunks: 0, toolResponse: null as unknown, sockets: 0, closed: false };
  let socket: WebSocketRoute | null = null;
  const send = (msg: unknown) => socket!.send(JSON.stringify(msg));
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    socket = ws;
    seen.sockets++;
    ws.onClose(() => (seen.closed = true));
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

  // WebSocket routes apply to pages loaded after they're registered.
  await page.goto("/chat");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  const voice = page.getByRole("region", { name: "Voice conversation" });
  await voice.getByRole("button", { name: "Start talking" }).click();
  await expect(voice.getByLabel("Microphone is on")).toBeVisible();

  // The microphone is really streaming PCM.
  await expect.poll(() => seen.audioChunks, { timeout: 15_000 }).toBeGreaterThan(5);
  expect(seen.setup).toMatchObject({ model: "models/gemini-3.8-live" });

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

  // Navi answers out loud (24 kHz PCM) with a transcript.
  const pcm = Buffer.alloc(24000 * 2 * 0.5); // half a second of silence
  send({ serverContent: { outputTranscription: { text: "Done. I added “Call the dentist”." }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcm.toString("base64") } }] } } });
  await expect(voice.getByText("Done. I added “Call the dentist”.")).toBeVisible();
  send({ serverContent: { turnComplete: true } });

  // The turn lands in the same conversation as typed messages.
  await expect
    .poll(async () => {
      const { data } = await admin.from("messages").select("role,content,modality,tool_events").eq("conversation_id", conversationId).order("created_at");
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

  // Back to text: ending voice hangs up, and the voice turn is in the chat history.
  await voice.getByRole("button", { name: "End voice" }).click();
  await expect.poll(() => seen.closed).toBe(true);
  await expect(voice.getByLabel("Microphone is on")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Add a task to call the dentist.")).toBeVisible();
  await expect(page.getByText(/Done\. I added “Call the dentist”\./)).toBeVisible();
});
