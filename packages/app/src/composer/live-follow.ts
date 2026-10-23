import { selectionFromLines, type FileSelection } from "@/workspaces/files/types"
import type { OpenCodeEventStream } from "@/runtime/server/client"
import { sameFile, type ComposerAttachment, type ComposerAttachmentFile } from "./composer-attachment"

// The commentID the followed chip carries while live-follow owns it.
const LIVE_FOLLOW_OWNER = "editor-bridge.live-follow"

// The builtin `editor-bridge` server plugin mirrors the attached editor's current file/selection
// through these events, so one tracked chip can follow the editor until the user pins it. Every store
// write goes through `ComposerAttachment`, the seam that mirrors the GUI-extension composer API.
type Options = {
  readonly attachment: ComposerAttachment
  readonly event: OpenCodeEventStream
  readonly preview: (path: string, selection: FileSelection) => string | undefined
}

export function createLiveFollow(options: Options) {
  // The file this module owns; a pinned or cleared chip is no longer replaced.
  let tracked: ComposerAttachmentFile | undefined

  const attachmentFile = (text: string): ComposerAttachmentFile | undefined => {
    const parsed = parseLiveText(text)

    if (!parsed) return undefined

    if (!parsed.range) return { path: parsed.path }

    const selection = selectionFromLines(parsed.range)

    return { path: parsed.path, selection, preview: options.preview(parsed.path, selection) }
  }

  const follow = (text: string) => {
    const next = attachmentFile(text)

    if (tracked && next && sameFile(tracked, next)) return

    if (tracked) options.attachment.detach(LIVE_FOLLOW_OWNER)
    tracked = undefined

    if (!next) return

    // A chip that is already attached was pinned or added by hand; never take it over.
    if (options.attachment.hasUnowned(next)) return

    options.attachment.attach(LIVE_FOLLOW_OWNER, next)
    tracked = next
  }

  const stops = [
    options.event.on("rpc.editor-bridge.context", (event) => follow(liveText(event))),
    options.event.on("rpc.editor-bridge.pin", (event) => {
      // A pin commits the tracked chip: it stays in the context as an unowned chip, no longer replaced.
      const text = liveText(event)

      if (!tracked && text) follow(text)
      options.attachment.release(LIVE_FOLLOW_OWNER)
      tracked = undefined
    }),
    options.event.on("rpc.editor-bridge.clear", () => {
      if (tracked || options.attachment.owned(LIVE_FOLLOW_OWNER)) options.attachment.detach(LIVE_FOLLOW_OWNER)
      tracked = undefined
    }),
  ]

  return () => stops.forEach((stop) => stop())
}

function liveText(event: { readonly data: { readonly text?: unknown } }) {
  return typeof event.data.text === "string" ? event.data.text : ""
}

/** Reads `@relative/path#Lx-y` from the bridge's text, tolerating a missing `@`; no path means no chip. */
function parseLiveText(text: string) {
  const body = text.startsWith("@") ? text.slice(1) : text
  const range = /#L(\d+)(?:-(\d+))?$/.exec(body)
  const path = range ? body.slice(0, range.index) : body

  if (!path) return undefined

  if (!range) return { path }

  return { path, range: { start: Number(range[1]), end: Number(range[2] ?? range[1]) } }
}
