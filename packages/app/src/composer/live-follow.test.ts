import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { OpenCodeEventStream } from "@/runtime/server/client"
import { createComposerAttachment } from "./composer-attachment"
import { createLiveFollow } from "./live-follow"
import { createMemoryComposerState, type ComposerState } from "./state"

const context = "rpc.opencode-vsc-bridge.context"
const pin = "rpc.opencode-vsc-bridge.pin"
const clear = "rpc.opencode-vsc-bridge.clear"
const owner = "opencode-vsc-bridge.live-follow"

type Handler = (event: { data: { text?: string } }) => void

function setup() {
  return createRoot((dispose) => {
    const prompt = createMemoryComposerState()
    const handlers = new Map<string, Handler[]>()
    const stream = {
      on(type: string, handler: Handler) {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])

        return () =>
          handlers.set(
            type,
            (handlers.get(type) ?? []).filter((item) => item !== handler),
          )
      },
    }
    const stop = createLiveFollow({
      attachment: createComposerAttachment(prompt),
      // The bridge emits RPC events; only the subscription surface matters here.
      event: stream as unknown as OpenCodeEventStream,
      preview: (path, selection) => `${path}:${selection.startLine}-${selection.endLine}`,
    })

    return {
      prompt,
      emit(type: string, text: string) {
        ;(handlers.get(type) ?? []).forEach((handler) => handler({ data: { text } }))
      },
      dispose() {
        stop()
        dispose()
      },
    }
  })
}

function chips(prompt: ComposerState) {
  return prompt.context
    .items()
    .flatMap((item) =>
      item.type === "file" ? [{ path: item.path, selection: item.selection, preview: item.preview }] : [],
    )
}

function owners(prompt: ComposerState) {
  return prompt.context.items().map((item) => item.commentID)
}

describe("live IDE follow", () => {
  test("context adds a file chip with its parsed selection", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L9-19")

    expect(chips(follow.prompt)).toEqual([
      {
        path: "src/a.ts",
        selection: { startLine: 9, endLine: 19, startChar: 0, endChar: 0 },
        preview: "src/a.ts:9-19",
      },
    ])
    follow.dispose()
  })

  test("a second context replaces the tracked chip", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L9-19")
    follow.emit(context, "@src/a.ts#L4")

    expect(chips(follow.prompt)).toEqual([
      {
        path: "src/a.ts",
        selection: { startLine: 4, endLine: 4, startChar: 0, endChar: 0 },
        preview: "src/a.ts:4-4",
      },
    ])
    follow.dispose()
  })

  test("a tracked chip is owned by the bridge", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L4")
    follow.emit(context, "@src/a.ts#L6")

    expect(owners(follow.prompt)).toEqual([owner])
    follow.dispose()
  })

  test("pin keeps the chip and stops replacing it", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L1")
    follow.emit(pin, "@src/a.ts#L1")
    follow.emit(context, "@src/a.ts#L3")

    expect(chips(follow.prompt).map((item) => item.selection?.startLine)).toEqual([1, 3])
    follow.dispose()
  })

  test("pin drops the ownership token", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L1")
    follow.emit(pin, "@src/a.ts#L1")

    expect(chips(follow.prompt).map((item) => item.selection?.startLine)).toEqual([1])
    expect(owners(follow.prompt)).toEqual([undefined])
    follow.dispose()
  })

  test("pin without a tracked chip adds one", () => {
    const follow = setup()

    follow.emit(pin, "@src/a.ts#L7")

    expect(chips(follow.prompt).map((item) => item.selection?.startLine)).toEqual([7])
    expect(owners(follow.prompt)).toEqual([undefined])
    follow.dispose()
  })

  test("clear leaves a pinned chip in place", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L1")
    follow.emit(pin, "@src/a.ts#L1")
    follow.emit(context, "@src/a.ts#L1")
    follow.emit(clear, "")

    expect(chips(follow.prompt).map((item) => item.selection?.startLine)).toEqual([1])
    follow.dispose()
  })

  test("clear removes the tracked chip", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L2-3")
    follow.emit(clear, "")

    expect(chips(follow.prompt)).toEqual([])
    follow.dispose()
  })

  test("an identical hand-added chip is not taken over", () => {
    const follow = setup()

    follow.prompt.context.add({
      type: "file",
      path: "src/a.ts",
      selection: { startLine: 1, endLine: 3, startChar: 0, endChar: 0 },
    })
    follow.emit(context, "@src/a.ts#L1-3")

    expect(chips(follow.prompt)).toHaveLength(1)
    expect(owners(follow.prompt)).toEqual([undefined])

    follow.emit(clear, "")
    expect(chips(follow.prompt)).toHaveLength(1)
    follow.dispose()
  })

  test("empty context text removes the tracked chip", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts#L2")
    follow.emit(context, "")

    expect(chips(follow.prompt)).toEqual([])
    follow.dispose()
  })

  test("a bare path produces a chip without a selection", () => {
    const follow = setup()

    follow.emit(context, "@src/a.ts")

    expect(chips(follow.prompt)).toEqual([{ path: "src/a.ts", selection: undefined, preview: undefined }])
    follow.dispose()
  })

  test("text without the @ prefix still parses", () => {
    const follow = setup()

    follow.emit(context, "src/a.ts#L5-6")

    expect(chips(follow.prompt).map((item) => item.selection?.startLine)).toEqual([5])
    follow.dispose()
  })
})
