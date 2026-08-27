import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BotApprovalPrompt } from "./BotApprovalPrompt";

const detail =
  "Allow gmail_send_message? This approval applies only to the pending action. It does not undo completed work.";

describe("BotApprovalPrompt", () => {
  it("renders the one-use warning and only the hub-provided decisions", () => {
    const markup = renderToStaticMarkup(
      <BotApprovalPrompt
        approval={{
          requestId: ApprovalRequestId.make("send-call"),
          requestKind: "command",
          createdAt: "2026-08-27T00:00:00.000Z",
          detail,
          options: [
            { decision: "decline", label: "Decline" },
            { decision: "accept", label: "Approve" },
          ],
        }}
        pendingCount={1}
        responding={false}
        error={null}
        onRespond={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="bot-approval-prompt"');
    expect(markup).toContain(detail);
    expect(markup).toContain(">Decline<");
    expect(markup).toContain(">Approve<");
    expect(markup).not.toContain("Always allow");
  });
});
