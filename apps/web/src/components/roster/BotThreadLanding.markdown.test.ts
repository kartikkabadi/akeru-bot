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

  it("renders the shared approval card in individual and group bot chats", () => {
    const botSource = NodeFS.readFileSync(
      new URL("./BotThreadLanding.tsx", import.meta.url),
      "utf8",
    );
    const groupSource = NodeFS.readFileSync(
      new URL("./GroupThreadLanding.tsx", import.meta.url),
      "utf8",
    );

    expect(botSource).toContain("<BotApprovalPrompt");
    expect(groupSource).toContain("<BotApprovalPrompt");
    expect(botSource).not.toContain("function BotChoicePrompt");
    expect(groupSource).not.toContain("function BotChoicePrompt");
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
