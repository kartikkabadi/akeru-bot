import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PendingUserInput } from "../../session-logic";
import { BotChoicePrompt } from "./BotChoicePrompt";

const choicePrompt: PendingUserInput = {
  requestId: ApprovalRequestId.make("choice-1"),
  createdAt: "2026-08-27T00:00:00.000Z",
  questions: [
    {
      id: "choice-1",
      header: "Question",
      question: "Coffee or tea?",
      options: [
        { label: "Coffee", description: "Choose coffee" },
        { label: "Tea", description: "Choose tea" },
      ],
      multiSelect: false,
    },
  ],
};

describe("BotChoicePrompt", () => {
  it("renders the agent question as selectable choices", () => {
    const markup = renderToStaticMarkup(
      <BotChoicePrompt prompt={choicePrompt} responding={false} error={null} onAnswer={vi.fn()} />,
    );

    expect(markup).toContain('data-testid="bot-choice-prompt"');
    expect(markup).toContain("Coffee or tea?");
    expect(markup).toContain(">Coffee</span>");
    expect(markup).toContain(">Tea</span>");
    expect(markup).not.toContain('aria-label="Answer"');
  });

  it("renders a text answer when the agent omits choices", () => {
    const markup = renderToStaticMarkup(
      <BotChoicePrompt
        prompt={{
          ...choicePrompt,
          questions: [{ ...choicePrompt.questions[0]!, options: [] }],
        }}
        responding={false}
        error={null}
        onAnswer={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Answer"');
    expect(markup).toContain(">Send</button>");
  });
});
