import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type ApprovalRequestId,
  type ProviderUserInputAnswers,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { derivePendingUserInputs } from "../../session-logic";
import { useThreadActivities } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function useRosterPendingUserInput(threadRef: ScopedThreadRef | null) {
  const activities = useThreadActivities(threadRef);
  const pendingUserInput = useMemo(
    () => derivePendingUserInputs(activities)[0] ?? null,
    [activities],
  );
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const [respondingRequestId, setRespondingRequestId] = useState<ApprovalRequestId | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const respond = useCallback(
    async (requestId: ApprovalRequestId, answers: ProviderUserInputAnswers): Promise<boolean> => {
      if (!threadRef || respondingRequestId !== null) return false;
      setRespondingRequestId(requestId);
      setResponseError(null);
      try {
        const result = await respondToUserInput({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, requestId, answers },
        });
        if (result._tag === "Failure") {
          const cause = squashAtomCommandFailure(result);
          setResponseError(cause instanceof Error ? cause.message : "Could not send your answer.");
          return false;
        }
        return true;
      } finally {
        setRespondingRequestId(null);
      }
    },
    [respondToUserInput, respondingRequestId, threadRef],
  );

  return {
    pendingUserInput,
    respond,
    responding: respondingRequestId === pendingUserInput?.requestId,
    responseError,
  };
}
