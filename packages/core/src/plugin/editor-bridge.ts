export * as EditorBridgePlugin from "./editor-bridge.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { RpcRegistration } from "@opencode/plugin/effect/rpc"
import { Deferred, Effect, Schema } from "effect"
import { Rpc } from "../rpc.js"
import type { PluginInternal } from "./internal.js"

const Context = Schema.Struct({
  /** Chip text, e.g. `@src/wire.ts#L76-110`, or "" when the editor has no file. */
  text: Schema.String,
})

const Definition = Rpc.define({
  id: "editor-bridge",
  methods: {
    // Live follow: the editor's current file/selection changed.
    update: { input: Context, output: Schema.Void },
    // Explicit pin: the user pressed the send key; the prompt commits the chip.
    pin: { input: Context, output: Schema.Void },
    // The editor lost track (closed, no workspace): clear the chip.
    clear: { input: Schema.Struct({}), output: Schema.Void },
  },
  events: {
    context: { schema: Context },
    pin: { schema: Context },
    clear: { schema: Schema.Struct({}) },
  },
})

export const Plugin = define({
  id: "opencode.editor.bridge",
  effect: Effect.fn("EditorBridgePlugin")(function* (ctx) {
    // Handlers emit through the registration, which only exists after
    // ctx.rpc.register returns; a Deferred breaks the cycle safely.
    const ready = yield* Deferred.make<RpcRegistration<typeof Definition>["events"]>()
    const emit = (name: "context" | "pin" | "clear", data: { readonly text: string }) =>
      Deferred.await(ready).pipe(
        Effect.flatMap((events) => events.emit(name, data)),
        Effect.orDie,
      )

    const registration = yield* ctx.rpc.register(Definition, {
      update: (input) => emit("context", input),
      pin: (input) => emit("pin", input),
      clear: () => emit("clear", { text: "" }),
    }).pipe(Effect.orDie)
    yield* Deferred.succeed(ready, registration.events)
  }),
} satisfies PluginInternal.InternalPlugin)
