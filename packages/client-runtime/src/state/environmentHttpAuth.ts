import * as Effect from "effect/Effect";
import { FetchHttpClient, type HttpMethod } from "effect/unstable/http";

import type { PreparedHttpAuthorization } from "../connection/model.ts";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
}

export const withEnvironmentCredentials = <A, E, R>(
  authorization: PreparedHttpAuthorization | null,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;

export const buildEnvironmentAuthHeaders = (
  authorization: PreparedHttpAuthorization | null,
  _method: HttpMethod.HttpMethod,
  _url: string,
  _signer?: unknown,
): Effect.Effect<EnvironmentHttpAuthHeaders> =>
  Effect.succeed(authorization === null ? {} : { authorization: `Bearer ${authorization.token}` });
