import type { OrchestrationMessage } from "@t3tools/contracts";

import { visibleBotChatMessages } from "./botConversationPresentation";

/**
 * Group fan-out: a group message starts one turn per addressed member on that
 * member's own group thread, so members work concurrently. Every outgoing
 * message carries a group-context note (stripped from display) so a member
 * knows who it is, who else is present, and when to stay silent.
 */
export const GROUP_SILENT_REPLY = "SILENT";

export const GROUP_CONTEXT_MARKER = "\n\n[group-context]";

export function buildGroupContextNote(input: {
  readonly memberName: string;
  readonly groupName: string;
  readonly memberNames: ReadonlyArray<string>;
  readonly everyone: boolean;
}): string {
  const others = input.memberNames.filter((name) => name !== input.memberName);
  const audience = input.everyone
    ? ` It was sent to every member; each member answers independently. Reply only when you add something useful; otherwise reply with exactly ${GROUP_SILENT_REPLY}.`
    : " It was addressed to you.";
  return (
    `${GROUP_CONTEXT_MARKER} You are ${input.memberName} in the group chat "${input.groupName}"` +
    (others.length > 0 ? ` together with ${others.join(", ")}.` : ".") +
    ` The message above is from the user.${audience}` +
    " Speak only as yourself. Never invent or write replies for other members."
  );
}

export function hasEveryoneMention(prompt: string): boolean {
  return /(^|\s)@everyone(?=$|\s|[.,!?:;])/i.test(prompt);
}

export function isSilentGroupReply(text: string): boolean {
  const trimmed = text.trim().replace(/^\[|\]$|\.$/g, "");
  return trimmed.toUpperCase() === GROUP_SILENT_REPLY;
}

export function stripGroupFanoutNote(text: string): string {
  const index = text.indexOf(GROUP_CONTEXT_MARKER);
  return index === -1 ? text : text.slice(0, index);
}

export interface GroupMemberFeed {
  readonly botId: string;
  readonly working: boolean;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}

export interface MergedGroupMessage {
  /** The member thread this message came from; attributes assistant replies. */
  readonly botId: string;
  readonly message: OrchestrationMessage;
}

/**
 * Merge the per-member group threads into one chronological conversation.
 * A fanned-out user message exists once per member thread with the same
 * createdAt, so it deduplicates by its display text to a single bubble.
 */
export function mergeGroupMemberMessages(
  feeds: ReadonlyArray<GroupMemberFeed>,
): MergedGroupMessage[] {
  const merged: MergedGroupMessage[] = [];
  const seenUserKeys = new Set<string>();
  for (const feed of feeds) {
    for (const message of visibleBotChatMessages(feed.messages, feed.working)) {
      if (message.role === "assistant") {
        if (isSilentGroupReply(message.text)) continue;
        merged.push({ botId: feed.botId, message });
        continue;
      }
      const text = stripGroupFanoutNote(message.text);
      const key = `${message.createdAt}|${text}`;
      if (seenUserKeys.has(key)) continue;
      seenUserKeys.add(key);
      merged.push({
        botId: feed.botId,
        message: text === message.text ? message : { ...message, text },
      });
    }
  }
  return merged.toSorted(
    (left, right) =>
      left.message.createdAt.localeCompare(right.message.createdAt) ||
      (left.message.role === "user" ? 0 : 1) - (right.message.role === "user" ? 0 : 1) ||
      left.message.id.localeCompare(right.message.id),
  );
}

export interface MentionSegment {
  readonly type: "text" | "mention";
  readonly text: string;
  /** Character offset in the source text; a stable render key. */
  readonly start: number;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Split message text so @mentions of known names render as highlighted tokens. */
export function splitMentionSegments(text: string, names: ReadonlyArray<string>): MentionSegment[] {
  const candidates = [...new Set(["everyone", ...names])]
    .filter((name) => name.length > 0)
    .toSorted((left, right) => right.length - left.length);
  if (candidates.length === 0 || !text.includes("@")) {
    return [{ type: "text", text, start: 0 }];
  }
  const pattern = new RegExp(`(^|\\s)(@(?:${candidates.map(escapeRegExp).join("|")}))`, "gi");
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + (match[1]?.length ?? 0);
    const mention = match[2] ?? "";
    if (start > cursor)
      segments.push({ type: "text", text: text.slice(cursor, start), start: cursor });
    segments.push({ type: "mention", text: mention, start });
    cursor = start + mention.length;
  }
  if (cursor < text.length)
    segments.push({ type: "text", text: text.slice(cursor), start: cursor });
  return segments.length > 0 ? segments : [{ type: "text", text, start: 0 }];
}
