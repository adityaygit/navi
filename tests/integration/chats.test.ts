import { beforeAll, describe, expect, it } from "vitest";
import { ctxFor, resetUser, userClient } from "./helpers";
import {
  createConversation,
  deleteConversation,
  findChat,
  handleTurn,
  listConversations,
  listMessages,
  renameConversation,
  titleFromText,
} from "@/server/ai/chat";
import { buildVoiceSession } from "@/server/ai/voice";

// Multiple chats: each has its own history, can be started, named, renamed,
// deleted, and is private to its owner. Onboarding stays separate.

let ctx: ReturnType<typeof ctxFor>;

beforeAll(async () => {
  const { db, userId } = await userClient("dev@navi.test");
  await resetUser(userId);
  ctx = ctxFor(db, userId);
});

describe("multiple chats", () => {
  it("starts a new chat when no conversation is given, and names it from the first message", async () => {
    const a = await handleTurn(ctx, { kind: "chat", text: "Help me think through my essay outline", modality: "text" });
    const b = await handleTurn(ctx, { kind: "chat", text: "What should I cook tonight", modality: "text" });
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(a.title).toBe("Help me think through my essay outline");
    const chats = await listConversations(ctx);
    expect(chats.map((c) => c.id)).toEqual([b.conversationId, a.conversationId]);
  });

  it("keeps each chat's history separate and continues the given chat", async () => {
    const a = await handleTurn(ctx, { kind: "chat", text: "first chat, message one", modality: "text" });
    const b = await handleTurn(ctx, { kind: "chat", text: "second chat, message one", modality: "text" });
    await handleTurn(ctx, { kind: "chat", conversationId: a.conversationId, text: "first chat, message two", modality: "text" });
    const inA = (await listMessages(ctx, a.conversationId)).filter((m) => m.role === "user").map((m) => m.content);
    const inB = (await listMessages(ctx, b.conversationId)).filter((m) => m.role === "user").map((m) => m.content);
    expect(inA).toEqual(["first chat, message one", "first chat, message two"]);
    expect(inB).toEqual(["second chat, message one"]);
    // The continued chat keeps its first name and moves to the top.
    expect((await findChat(ctx, a.conversationId))?.title).toBe("first chat, message one");
    expect((await listConversations(ctx))[0].id).toBe(a.conversationId);
  });

  it("renames, deletes, and refuses a deleted chat", async () => {
    const id = await createConversation(ctx, "chat");
    expect((await findChat(ctx, id))?.title).toBe("New chat");
    await renameConversation(ctx, id, "  Trip   planning ");
    expect((await findChat(ctx, id))?.title).toBe("Trip planning");
    await handleTurn(ctx, { kind: "chat", conversationId: id, text: "Book flights", modality: "text" });
    expect((await findChat(ctx, id))?.title).toBe("Trip planning"); // a chosen name isn't overwritten
    await deleteConversation(ctx, id);
    expect(await findChat(ctx, id)).toBeNull();
    expect(await listMessages(ctx, id)).toEqual([]);
    await expect(handleTurn(ctx, { kind: "chat", conversationId: id, text: "hello?", modality: "text" })).rejects.toThrow(/no longer exists/);
    await expect(renameConversation(ctx, id, "x")).rejects.toThrow();
  });

  it("keeps onboarding out of the chat list and out of chat management", async () => {
    const onboarding = await handleTurn(ctx, { kind: "onboarding", text: "hi", modality: "text" });
    expect((await listConversations(ctx)).some((c) => c.id === onboarding.conversationId)).toBe(false);
    await expect(deleteConversation(ctx, onboarding.conversationId)).rejects.toThrow();
    await expect(handleTurn(ctx, { kind: "chat", conversationId: onboarding.conversationId, text: "x", modality: "text" })).rejects.toThrow(/no longer exists/);
  });

  it("starts voice in the chosen chat with only that chat's history", async () => {
    const a = await handleTurn(ctx, { kind: "chat", text: "voice test: the marmalade topic", modality: "text" });
    await handleTurn(ctx, { kind: "chat", text: "voice test: the unrelated topic", modality: "text" });
    const session = await buildVoiceSession(ctx, "chat", a.conversationId);
    expect(session.conversationId).toBe(a.conversationId);
    const system = String(session.config.systemInstruction);
    expect(system).toContain("marmalade");
    expect(system).not.toContain("unrelated topic");
  });

  it("is private to its owner", async () => {
    const mine = await createConversation(ctx, "chat");
    const other = await userClient("alice@navi.test");
    const theirs = ctxFor(other.db, other.userId);
    expect(await findChat(theirs, mine)).toBeNull();
    await expect(handleTurn(theirs, { kind: "chat", conversationId: mine, text: "sneaky", modality: "text" })).rejects.toThrow();
    await expect(deleteConversation(theirs, mine)).rejects.toThrow();
    await expect(renameConversation(theirs, mine, "mine now")).rejects.toThrow();
    expect((await findChat(ctx, mine))?.title).toBe("New chat");
  });
});

describe("titleFromText", () => {
  it("shortens long first messages at a word boundary", () => {
    expect(titleFromText("short one")).toBe("short one");
    const t = titleFromText("I need to plan out the whole semester including every exam and the group project deadlines");
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/\s…$/);
  });
});
