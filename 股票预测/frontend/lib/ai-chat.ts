import type { AiChatMessage, AiChatThread } from "./types";

export const AI_CHAT_MESSAGE_LIMIT = 24;

export function createChatMessage(role: AiChatMessage["role"], content: string): AiChatMessage {
  return { id: crypto.randomUUID(), role, content: content.trim(), created_at: new Date().toISOString() };
}

export function compactChatThread(messages: AiChatMessage[], existingSummary = ""): AiChatThread {
  const clean = messages.filter((message) => message.content.trim());
  if (clean.length <= AI_CHAT_MESSAGE_LIMIT) return { messages: clean, summary: existingSummary || undefined, updated_at: new Date().toISOString() };
  const archived = clean.slice(0, clean.length - 16);
  const summary = [existingSummary, ...archived.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)]
    .filter(Boolean)
    .join("\n")
    .slice(-2400);
  return { messages: clean.slice(-16), summary, updated_at: new Date().toISOString() };
}

export function conversationForApi(thread?: AiChatThread): Array<{ role: "user" | "assistant"; content: string }> {
  if (!thread) return [];
  return [
    ...(thread.summary ? [{ role: "assistant" as const, content: `Earlier conversation summary:\n${thread.summary}` }] : []),
    ...thread.messages.slice(-12).map(({ role, content }) => ({ role, content })),
  ];
}

