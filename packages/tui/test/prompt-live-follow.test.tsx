import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory } from "./fixture/tui-client"

// Earlier app tests in this process can leave a home draft that the prompt would restore.
beforeEach(() => takeDraft(undefined))

const rpc = (method: string, text: string) => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  created: Date.now(),
  type: `rpc.opencode-vsc-bridge.${method}`,
  location: { directory },
  data: { text },
})

test("live IDE follow chip replaces the trailing chip in the prompt", async () => {
  await using setup = await createAppFixture({})
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))

  const editor = () => setup.renderer.currentFocusedEditor!

  // First chip appears.
  setup.events.emit(rpc("context", "@AAA.ts#L1-2") as never)
  await setup.waitFor(() => editor().plainText.includes("@AAA.ts#L1-2"))
  expect(editor().plainText).toBe("@AAA.ts#L1-2 ")

  // Second update replaces the chip rather than appending.
  setup.events.emit(rpc("context", "@BBB.ts#L3-4") as never)
  await setup.waitFor(() => editor().plainText.includes("@BBB.ts#L3-4"))
  expect(editor().plainText).toBe("@BBB.ts#L3-4 ")

  // The chip is a real file extmark spanning the whole mention.
  const marks = editor().editorView.extmarks.getAll()
  expect(marks).toHaveLength(1)
  const mark = marks[0]
  expect(editor().plainText.slice(mark.start, mark.end)).toBe("@BBB.ts#L3-4")
})

test("live IDE follow clear removes the chip", async () => {
  await using setup = await createAppFixture({})
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  const editor = () => setup.renderer.currentFocusedEditor!

  setup.events.emit(rpc("context", "@AAA.ts#L1-2") as never)
  await setup.waitFor(() => editor().plainText.includes("@AAA.ts#L1-2"))

  setup.events.emit(rpc("clear", "") as never)
  await setup.waitFor(() => editor().plainText === "")
  expect(editor().editorView.extmarks.getAll()).toHaveLength(0)
})

test("live IDE follow pin commits the chip as ordinary prompt text", async () => {
  await using setup = await createAppFixture({})
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  const editor = () => setup.renderer.currentFocusedEditor!

  setup.events.emit(rpc("context", "@AAA.ts#L1-2") as never)
  await setup.waitFor(() => editor().plainText.includes("@AAA.ts#L1-2"))
  setup.events.emit(rpc("pin", "@AAA.ts#L1-2") as never)

  // A subsequent update must NOT replace a pinned chip; it appends a new one.
  setup.events.emit(rpc("context", "@BBB.ts#L3-4") as never)
  await setup.waitFor(() => editor().plainText.includes("@BBB.ts#L3-4"))
  expect(editor().plainText).toBe("@AAA.ts#L1-2 @BBB.ts#L3-4 ")
})
