import type { OrderedConversationMessage } from "./ai-shared-conversation.js";

const MAX_TRANSCRIPT_CHARS = 18_000;
const CONVERSATION_OMISSION =
  "\n\n[... middle of long conversation omitted ...]\n\n";
const MESSAGE_OMISSION = "\n[... message truncated ...]\n";
const FIRST_MESSAGE_SHARE = 0.35;

function messageBlock(
  message: OrderedConversationMessage,
  index: number,
): string {
  return `MESSAGE ${index + 1} ROLE=${message.role}\n${message.text}`;
}

function truncateBlock(block: string, maxChars: number): string {
  if (block.length <= maxChars) return block;
  if (maxChars <= MESSAGE_OMISSION.length) return block.slice(0, maxChars);

  const available = maxChars - MESSAGE_OMISSION.length;
  const headChars = Math.ceil(available * 0.75);
  const tailChars = available - headChars;
  return `${block.slice(0, headChars)}${MESSAGE_OMISSION}${block.slice(
    -tailChars,
  )}`;
}

export function serializeSharedConversation(
  messages: OrderedConversationMessage[],
): string {
  const blocks = messages.map(messageBlock);
  const transcript = blocks.join("\n\n");
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  if (blocks.length === 1)
    return truncateBlock(blocks[0] ?? "", MAX_TRANSCRIPT_CHARS);

  const available = MAX_TRANSCRIPT_CHARS - CONVERSATION_OMISSION.length;
  const firstBudget = Math.floor(available * FIRST_MESSAGE_SHARE);
  const recentBudget = available - firstBudget;
  const first = truncateBlock(blocks[0] ?? "", firstBudget);

  let recent = "";
  for (let index = blocks.length - 1; index >= 1; index -= 1) {
    const block = blocks[index] ?? "";
    const separator = recent ? "\n\n" : "";
    const remaining = recentBudget - recent.length - separator.length;
    if (remaining <= 0) break;

    const next =
      block.length <= remaining ? block : truncateBlock(block, remaining);
    recent = `${next}${separator}${recent}`;
    if (block.length > remaining) break;
  }

  return `${first}${CONVERSATION_OMISSION}${recent}`;
}
