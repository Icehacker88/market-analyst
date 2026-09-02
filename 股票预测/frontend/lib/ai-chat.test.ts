import { describe, expect, it, vi } from "vitest";
import { AI_CHAT_MESSAGE_LIMIT, compactChatThread, conversationForApi, createChatMessage } from "./ai-chat";
import type { AiChatMessage } from "./types";

describe("AI chat persistence", () => {
  it("creates a stable message shape", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "message-id" });
    const message = createChatMessage("user", "  hello  ");
    expect(message).toMatchObject({ id: "message-id", role: "user", content: "hello" });
    expect(message.created_at).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("compacts long conversations and sends only bounded context", () => {
    const messages: AiChatMessage[] = Array.from({ length: AI_CHAT_MESSAGE_LIMIT + 8 }, (_, index) => ({
      id: String(index),
      role: index % 2 ? "assistant" : "user",
      content: `message ${index}`,
      created_at: new Date(index * 1000).toISOString(),
    }));
    const compacted = compactChatThread(messages, "old summary");
    expect(compacted.messages).toHaveLength(16);
    expect(compacted.summary).toContain("old summary");
    expect(compacted.summary).toContain("message 0");
    const conversation = conversationForApi(compacted);
    expect(conversation).toHaveLength(13);
    expect(conversation[0].content).toContain("Earlier conversation summary");
    expect(conversation.at(-1)?.content).toBe(`message ${messages.length - 1}`);
  });
});
