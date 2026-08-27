// @effect-diagnostics nodeBuiltinImport:off - This integration guard reads its sibling source.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("BotThreadLanding message formatting", () => {
  it("uses the rich bot message renderer in individual and group threads", () => {
    const botSource = NodeFS.readFileSync(
      new URL("./BotThreadLanding.tsx", import.meta.url),
      "utf8",
    );
    const groupSource = NodeFS.readFileSync(
      new URL("./GroupThreadLanding.tsx", import.meta.url),
      "utf8",
    );

    for (const [source, userMessageTestId] of [
      [botSource, "bot-user-message"],
      [groupSource, "group-user-message"],
    ]) {
      expect(source).toContain('import { BotMessageMarkdown } from "./BotMessageMarkdown"');
      expect(source).toContain("<BotMessageMarkdown");
      expect(source).toContain("cwd={runtime.defaultProject?.workspaceRoot}");
      expect(source).toContain("threadRef={runtime.linkedThreadRef ?? undefined}");

      const userMessageSource = source.slice(source.indexOf(`data-testid="${userMessageTestId}"`));
      expect(userMessageSource).toContain('<p className="whitespace-pre-wrap">{message.text}</p>');
      expect(userMessageSource).not.toContain("<BotMessageMarkdown");
    }
  });

  it("uses the free-scrolling conversation area instead of end-justified overflow", () => {
    const botSource = NodeFS.readFileSync(
      new URL("./BotThreadLanding.tsx", import.meta.url),
      "utf8",
    );
    const groupSource = NodeFS.readFileSync(
      new URL("./GroupThreadLanding.tsx", import.meta.url),
      "utf8",
    );

    expect(botSource).toContain("<BotConversationScrollArea>");
    expect(groupSource).toContain("<BotConversationScrollArea>");
    expect(botSource).not.toContain("justify-end gap-4");
    expect(groupSource).not.toContain("justify-end gap-4");
  });
});
