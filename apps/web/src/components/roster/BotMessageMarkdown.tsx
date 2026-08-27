import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "../ChatMarkdown";

export function BotMessageMarkdown({
  text,
  cwd,
  threadRef,
}: {
  readonly text: string;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
}) {
  return <ChatMarkdown className="mt-1" cwd={cwd} text={text} threadRef={threadRef} />;
}
