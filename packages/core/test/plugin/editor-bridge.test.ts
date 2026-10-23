import { expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Plugin } from "@opencode/core/plugin"
import { EditorBridgePlugin } from "@opencode/core/plugin/editor-bridge"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { Effect, Fiber, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("re-emits editor bridge methods as rpc editor events", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const bus = yield* Bus.Service
    const rpc = yield* Rpc.Service
    yield* EditorBridgePlugin.Plugin.effect(yield* PluginHost.make(plugins))

    const events = yield* bus.subscribe().pipe(
      Stream.filter((event) => event.type.startsWith("rpc.editor-bridge.")),
      Stream.take(3),
      Stream.runCollect,
      Effect.forkScoped,
    )
    yield* Effect.yieldNow

    yield* rpc.call("editor-bridge", "update", { text: "@src/a.ts#L1-2" })
    yield* rpc.call("editor-bridge", "pin", { text: "@src/a.ts#L9" })
    yield* rpc.call("editor-bridge", "clear", {})

    const collected = yield* Fiber.join(events)
    expect([...collected].map((event) => [event.type, event.data])).toEqual([
      ["rpc.editor-bridge.context", { text: "@src/a.ts#L1-2" }],
      ["rpc.editor-bridge.pin", { text: "@src/a.ts#L9" }],
      ["rpc.editor-bridge.clear", { text: "" }],
    ])
  }),
)
