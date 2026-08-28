import { ArrowDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import {
  isConversationAtEnd,
  reduceConversationFollowState,
  type ConversationFollowState,
} from "./botConversationScroll.logic";

export function BotConversationScrollArea({
  children,
  followRevision,
}: {
  readonly children: ReactNode;
  readonly followRevision?: string | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followStateRef = useRef<ConversationFollowState>({
    followingEnd: true,
    programmaticScroll: false,
  });
  const [isAtEnd, setIsAtEnd] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const updateScrollState = () => {
      const nextIsAtEnd = isConversationAtEnd(viewport);
      setIsAtEnd(nextIsAtEnd);
      followStateRef.current = reduceConversationFollowState(followStateRef.current, {
        type: "scroll",
        isAtEnd: nextIsAtEnd,
      });
    };

    const followContentGrowth = () => {
      if (followStateRef.current.followingEnd) {
        viewport.scrollTop = viewport.scrollHeight;
      }
      updateScrollState();
    };

    viewport.scrollTop = viewport.scrollHeight;
    updateScrollState();
    const observer = new ResizeObserver(followContentGrowth);
    observer.observe(content);
    viewport.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  useLayoutEffect(() => {
    if (followRevision == null) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextState = reduceConversationFollowState(followStateRef.current, {
      type: "message-submitted",
    });
    followStateRef.current = nextState;
    if (nextState.followingEnd) viewport.scrollTop = viewport.scrollHeight;
  }, [followRevision]);

  const stopFollowingEnd = () => {
    followStateRef.current = reduceConversationFollowState(followStateRef.current, {
      type: "user-navigation",
    });
  };

  const scrollToEnd = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    followStateRef.current = reduceConversationFollowState(followStateRef.current, {
      type: "scroll-to-end",
    });
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative min-h-0 flex-1" data-testid="bot-conversation-scroll-area">
      <div
        ref={viewportRef}
        className="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
        onTouchMove={stopFollowingEnd}
        onWheel={(event) => {
          if (event.deltaY < 0) stopFollowingEnd();
        }}
      >
        <div ref={contentRef} className="flex min-h-full w-full flex-col">
          <div className="mt-auto flex w-full flex-col gap-4">{children}</div>
        </div>
      </div>

      {!isAtEnd ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Scroll to latest message"
          className="absolute bottom-3 start-1/2 z-10 -translate-x-1/2 rounded-full bg-popover shadow-lg"
          onClick={scrollToEnd}
        >
          <ArrowDownIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
