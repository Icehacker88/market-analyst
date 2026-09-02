import { describe, expect, it } from "vitest";
import { extractSseBlocks, parseSseBlock } from "./sse";

describe("SSE parsing", () => {
  it("accepts CRLF-delimited events", () => {
    const parsed = extractSseBlocks("event: token\r\ndata: {\"text\":\"hello\"}\r\n\r\n");
    expect(parsed.rest).toBe("");
    expect(parseSseBlock(parsed.blocks[0])).toEqual({ event: "token", data: "{\"text\":\"hello\"}" });
  });

  it("flushes the final event without a trailing blank line", () => {
    const parsed = extractSseBlocks("data: {\"done\":true}", true);
    expect(parsed.rest).toBe("");
    expect(parseSseBlock(parsed.blocks[0]).data).toBe("{\"done\":true}");
  });
});
