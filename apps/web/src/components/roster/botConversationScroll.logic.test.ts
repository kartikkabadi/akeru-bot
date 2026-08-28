import { describe, expect, it } from "vite-plus/test";

import { isConversationAtEnd, reduceConversationFollowState } from "./botConversationScroll.logic";

describe("isConversationAtEnd", () => {
  it("treats underflowing and end-aligned conversations as live", () => {
    expect(isConversationAtEnd({ scrollTop: 0, scrollHeight: 400, clientHeight: 600 })).toBe(true);
    expect(isConversationAtEnd({ scrollTop: 400, scrollHeight: 1000, clientHeight: 600 })).toBe(
      true,
    );
  });

  it("stops live follow when the user moves above the end threshold", () => {
    expect(isConversationAtEnd({ scrollTop: 300, scrollHeight: 1000, clientHeight: 600 })).toBe(
      false,
    );
    expect(isConversationAtEnd({ scrollTop: 378, scrollHeight: 1000, clientHeight: 600 })).toBe(
      true,
    );
  });
});

describe("reduceConversationFollowState", () => {
  it("does not follow streaming growth after the user scrolls away", () => {
    const state = reduceConversationFollowState(
      { followingEnd: true, programmaticScroll: false },
      { type: "user-navigation" },
    );

    expect(state).toEqual({ followingEnd: false, programmaticScroll: false });
  });

  it("keeps a submitted message in view only when the user was following the end", () => {
    expect(
      reduceConversationFollowState(
        { followingEnd: true, programmaticScroll: false },
        { type: "message-submitted" },
      ),
    ).toEqual({ followingEnd: true, programmaticScroll: true });
    expect(
      reduceConversationFollowState(
        { followingEnd: false, programmaticScroll: false },
        { type: "message-submitted" },
      ),
    ).toEqual({ followingEnd: false, programmaticScroll: false });
  });

  it("re-enables live follow when the user returns to the end", () => {
    const state = reduceConversationFollowState(
      { followingEnd: false, programmaticScroll: false },
      { type: "scroll", isAtEnd: true },
    );

    expect(state).toEqual({ followingEnd: true, programmaticScroll: false });
  });

  it("keeps a smooth scroll active until it reaches the end", () => {
    const started = reduceConversationFollowState(
      { followingEnd: false, programmaticScroll: false },
      { type: "scroll-to-end" },
    );
    const inProgress = reduceConversationFollowState(started, { type: "scroll", isAtEnd: false });
    const finished = reduceConversationFollowState(inProgress, { type: "scroll", isAtEnd: true });

    expect(inProgress).toEqual({ followingEnd: true, programmaticScroll: true });
    expect(finished).toEqual({ followingEnd: true, programmaticScroll: false });
  });
});
