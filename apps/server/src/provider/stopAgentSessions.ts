import type { ProviderSession } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { AgentControllerShape } from "./Services/AgentController.ts";

/** Stops the selected live agent sessions and logs each isolated cleanup failure. */
export function stopAgentSessions(
  agentController: AgentControllerShape,
  input: {
    readonly logMessage: string;
    readonly include?: (session: ProviderSession) => boolean;
  },
) {
  return Effect.gen(function* () {
    const sessions = yield* agentController.listSessions();
    yield* Effect.forEach(
      input.include ? sessions.filter(input.include) : sessions,
      (session) =>
        agentController.stopSession({ threadId: session.threadId }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(input.logMessage, {
              threadId: session.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      { discard: true },
    );
  });
}
