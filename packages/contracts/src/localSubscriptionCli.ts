import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LocalSubscriptionCliId = Schema.Literals([
  "claude",
  "codex",
  "cursor",
  "gemini",
  "grok",
  "opencode",
]);
export type LocalSubscriptionCliId = typeof LocalSubscriptionCliId.Type;

export const LocalSubscriptionCliStatus = Schema.Struct({
  id: LocalSubscriptionCliId,
  label: TrimmedNonEmptyString,
  state: Schema.Literals(["detected", "missing"]),
  command: TrimmedNonEmptyString,
  resolvedPath: Schema.optional(TrimmedNonEmptyString),
  nextStep: TrimmedNonEmptyString,
});
export type LocalSubscriptionCliStatus = typeof LocalSubscriptionCliStatus.Type;

export const LocalSubscriptionCliStatuses = Schema.Struct({
  providers: Schema.Array(LocalSubscriptionCliStatus),
});
export type LocalSubscriptionCliStatuses = typeof LocalSubscriptionCliStatuses.Type;
