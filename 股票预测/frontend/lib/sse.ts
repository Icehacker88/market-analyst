export type SseMessage = {
  event?: string;
  data: string;
};

export function extractSseBlocks(buffer: string, flush = false): { blocks: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = flush ? "" : parts.pop() || "";
  return { blocks: parts.filter((part) => part.trim()), rest };
}

export function parseSseBlock(block: string): SseMessage {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return { event, data };
}
