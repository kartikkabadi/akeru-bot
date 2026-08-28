// @effect-diagnostics nodeBuiltinImport:off - This integration guard reads its sibling source.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("BotThreadLanding message formatting", () => {
  it("renders assistant messages with the shared rich markdown component", () => {
    const source = NodeFS.readFileSync(new URL("./BotThreadLanding.tsx", import.meta.url), "utf8");

    expect(source).toContain('import ChatMarkdown from "../ChatMarkdown"');
    expect(source).toContain("<ChatMarkdown");
    expect(source).toContain("cwd={runtime.defaultProject?.workspaceRoot}");
    expect(source).toContain("threadRef={runtime.linkedThreadRef ?? undefined}");
  });

  it("uses the free-scrolling conversation area and follows submitted messages", () => {
    const botSource = NodeFS.readFileSync(
      new URL("./BotThreadLanding.tsx", import.meta.url),
      "utf8",
    );
    const groupSource = NodeFS.readFileSync(
      new URL("./GroupThreadLanding.tsx", import.meta.url),
      "utf8",
    );

    expect(botSource).toContain("<BotConversationScrollArea followRevision={followRevision}>");
    expect(groupSource).toContain("<BotConversationScrollArea followRevision={followRevision}>");
    expect(botSource).toContain("<BotChoicePrompt");
    expect(groupSource).toContain("<BotChoicePrompt");
    expect(botSource).not.toContain("justify-end gap-4");
    expect(groupSource).not.toContain("justify-end gap-4");
  });
});
