import type { SDKMessage } from "@cursor/sdk";

export async function collectAssistantText(
  stream: AsyncGenerator<SDKMessage, void>,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type !== "assistant") continue;
    for (const block of event.message.content) {
      if (block.type === "text") text += block.text;
    }
  }
  return text;
}

export async function pipeAssistantStream(
  stream: AsyncGenerator<SDKMessage, void>,
  onChunk: (text: string) => void,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type !== "assistant") continue;
    for (const block of event.message.content) {
      if (block.type === "text") {
        text += block.text;
        onChunk(block.text);
      }
    }
  }
  return text;
}
