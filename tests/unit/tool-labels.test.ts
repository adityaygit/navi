import { describe, expect, it } from "vitest";
import { readStepsLine, stepDoing, stepDone } from "@/lib/tool-labels";
import { readChatStream, type ChatStreamEvent } from "@/lib/chat-stream";

describe("tool step labels", () => {
  it("names what a step is doing, did, or couldn't do", () => {
    expect(stepDoing("create_task")).toBe("Adding task");
    expect(stepDone("create_task")).toBe("Added task");
    expect(stepDone("create_task", false)).toBe("Couldn't add task");
    expect(stepDone("request_external_action", false)).toBe("Couldn't ask for your OK");
    expect(stepDoing("some_new_tool")).toBe("Some new tool");
  });

  it("collapses read-only steps into one quiet line", () => {
    expect(readStepsLine(["get_overview"], true)).toBe("Looking at your plan…");
    expect(readStepsLine(["get_overview", "get_inbox", "get_overview"], false)).toBe("Looked at your plan and inbox");
  });
});

describe("readChatStream", () => {
  it("parses events split across chunks", async () => {
    const lines = [{ type: "text", delta: "Hello ", segment: 0 }, { type: "reset" }].map((e) => `${JSON.stringify(e)}\n`).join("");
    const bytes = new TextEncoder().encode(lines);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7));
        c.enqueue(bytes.slice(7, 30));
        c.enqueue(bytes.slice(30));
        c.close();
      },
    });
    const got: ChatStreamEvent[] = [];
    await readChatStream(body, (e) => got.push(e));
    expect(got).toEqual([{ type: "text", delta: "Hello ", segment: 0 }, { type: "reset" }]);
  });
});
