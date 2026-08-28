export interface ConversationScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const CONVERSATION_END_THRESHOLD_PX = 24;

export interface ConversationFollowState {
  readonly followingEnd: boolean;
  readonly programmaticScroll: boolean;
}

export type ConversationFollowEvent =
  | { readonly type: "user-navigation" }
  | { readonly type: "message-submitted" }
  | { readonly type: "scroll-to-end" }
  | { readonly type: "scroll"; readonly isAtEnd: boolean };

export function reduceConversationFollowState(
  state: ConversationFollowState,
  event: ConversationFollowEvent,
): ConversationFollowState {
  if (event.type === "user-navigation") {
    return { followingEnd: false, programmaticScroll: false };
  }
  if (event.type === "message-submitted") {
    return state.followingEnd
      ? { followingEnd: true, programmaticScroll: true }
      : { followingEnd: false, programmaticScroll: false };
  }
  if (event.type === "scroll-to-end") {
    return { followingEnd: true, programmaticScroll: true };
  }
  if (event.isAtEnd) {
    return { followingEnd: true, programmaticScroll: false };
  }
  return state.programmaticScroll ? state : { followingEnd: false, programmaticScroll: false };
}

export function isConversationAtEnd(
  metrics: ConversationScrollMetrics,
  threshold = CONVERSATION_END_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}
