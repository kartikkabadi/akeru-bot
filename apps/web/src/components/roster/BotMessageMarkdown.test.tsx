import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import { BotMessageMarkdown } from "./BotMessageMarkdown";

function renderBotMessage(text: string) {
  return renderToStaticMarkup(
    <BotMessageMarkdown cwd={undefined} threadRef={undefined} text={text} />,
  );
}

describe("BotMessageMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderBotMessage(
      ["| Item | State |", "| --- | --- |", "| Tests | Passing |"].join("\n"),
    );

    expect(html).toContain("chat-markdown-table-container");
    expect(html).toContain("<table");
    expect(html).toContain("Tests");
    expect(html).toContain("Passing");
  });

  it("renders read-only task checklists", () => {
    const html = renderBotMessage("- [x] Render table\n- [ ] Review diff");

    expect(html).toContain("task-list-item");
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('checked=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain('readOnly=""');
  });

  it("renders diff fences as highlighted code blocks", () => {
    const html = renderBotMessage(
      ["```diff", "-const state = 'plain';", "+const state = 'rich';", "```"].join("\n"),
    );

    expect(html).toContain("chat-markdown-codeblock");
    expect(html).toContain('data-language="diff"');
    expect(html).toContain("language-diff");
  });
});
