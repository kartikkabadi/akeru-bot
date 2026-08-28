import type { OrchestrationMessage, OrchestrationThreadActivity } from "@t3tools/contracts";

/**
 * The newest turn failure since the last user message, so a dead turn shows an
 * error row in the chat instead of leaving a silent, reply-less conversation.
 */
export function latestTurnFailureDetail(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  lastUserMessageCreatedAt: string | null,
): string | null {
  if (lastUserMessageCreatedAt === null) return null;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.createdAt < lastUserMessageCreatedAt) continue;
    if (activity.kind !== "provider.turn.start.failed" && activity.kind !== "runtime.error") {
      continue;
    }
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.message === "string"
          ? payload.message
          : activity.summary;
    return detail.split("\n", 1)[0] ?? activity.summary;
  }
  return null;
}

/**
 * The bot owes a reply while the newest durable record is a user message or a
 * still-streaming assistant partial. This anchors the working shimmer on the
 * conversation itself instead of volatile provider session states, which flap
 * through stop/restart transitions mid-turn. `turnFailed` stops the shimmer
 * when the turn ended without an answer (error or interrupt).
 */
export function botAwaitsReply(
  messages: ReadonlyArray<OrchestrationMessage>,
  options?: { readonly turnFailed?: boolean },
): boolean {
  if (options?.turnFailed) return false;
  const last = messages.at(-1);
  if (!last) return false;
  return last.role === "user" || (last.role === "assistant" && last.streaming);
}

/**
 * Bot chat shows each user message and one final assistant answer per turn.
 * Provider progress and intermediate assistant records stay behind the working
 * status so one provider turn cannot appear as several bot replies.
 */
export function visibleBotChatMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
  working = false,
): ReadonlyArray<OrchestrationMessage> {
  const latestAssistantIndexByResponse = new Map<string, number>();
  let precedingUserId = "before-first-user";
  let lastUserIndex = -1;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      precedingUserId = message.id;
      lastUserIndex = index;
      return;
    }
    if (message.role !== "assistant" || message.streaming) return;
    latestAssistantIndexByResponse.set(message.turnId ?? precedingUserId, index);
  });

  precedingUserId = "before-first-user";
  return messages.filter((message, index) => {
    if (message.role === "user") {
      precedingUserId = message.id;
      return true;
    }
    if (message.role !== "assistant" || message.streaming) return false;
    if (working && index > lastUserIndex) return false;
    return latestAssistantIndexByResponse.get(message.turnId ?? precedingUserId) === index;
  });
}
