import * as Context from "effect/Context";

import type { ProviderServiceShape } from "./ProviderService.ts";

/**
 * Adapter from Akeru's AgentController seam to the existing CLI-backed
 * provider runtimes. The provider-neutral runtime does not drive CLI session
 * contracts, so the bridge keeps those adapters behind the controller instead
 * of exposing them to orchestration reactors.
 */
export class LegacyProviderBridge extends Context.Service<
  LegacyProviderBridge,
  ProviderServiceShape
>()("akeru-bot/provider/Services/LegacyProviderBridge") {}
