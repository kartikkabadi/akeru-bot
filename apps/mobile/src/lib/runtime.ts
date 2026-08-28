import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Socket from "effect/unstable/socket/Socket";

import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { cryptoLayer } from "./crypto";
import { tracingLayer } from "../features/observability/tracing";
import * as Persistence from "../persistence/layer";

const httpClientLayer = remoteHttpClientLayer(fetch);
const runtimeLayer = Layer.mergeAll(
  Socket.layerWebSocketConstructorGlobal,
  cryptoLayer,
  httpClientLayer,
  tracingLayer.pipe(Layer.provide(httpClientLayer)),
  Persistence.layer,
);
type RuntimeLayerSource = typeof runtimeLayer;
export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(runtimeLayer);
export const runtimeContextLayer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);
