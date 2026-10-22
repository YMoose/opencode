import type { FileSelection } from "@/workspaces/files/types"
import type { FileContextItem } from "./schema"
import type { ComposerState } from "./state"

// Mirrors the GUI-extension Composer surface (host-apis.ts) so the live-follow sink can later swap to
// screen.composer.attach/update/detach with no logic changes. The official SDK has no list() and cannot dedupe
// a chip against an identical hand-added one without a token (see `contextItemKey`), which this adapter supplies
// over the core store. `owner` is the chip's `commentID`, the same ownership token the SDK uses.
export type ComposerAttachmentFile = {
  path: string
  selection?: FileSelection
  preview?: string
}

export type ComposerAttachment = {
  /** Adds a chip owned by `owner`; an identical chip already owned by it is not duplicated. */
  attach(owner: string, file: ComposerAttachmentFile): void
  /** Removes the chip owned by `owner`; a chip nobody owns is untouched. */
  detach(owner: string): void
  /** Detaches the chip owned by `owner` and keeps it as an unowned chip, dropping the ownership token. */
  release(owner: string): void
  /** A chip identical to `file` that nobody owns, so taking it over would duplicate or capture it. */
  hasUnowned(file: ComposerAttachmentFile): boolean
  /** The file chip owned by `owner`, at most one by convention. */
  owned(owner: string): (FileContextItem & { key: string }) | undefined
}

export function createComposerAttachment(prompt: Pick<ComposerState, "context">): ComposerAttachment {
  const owned = (owner: string) =>
    prompt.context
      .items()
      .find((item): item is FileContextItem & { key: string } => item.type === "file" && item.commentID === owner)

  return {
    attach(owner, file) {
      prompt.context.add({ type: "file", ...file, commentID: owner })
    },
    detach(owner) {
      prompt.context.removeComment(owner)
    },
    release(owner) {
      const item = owned(owner)

      if (!item) return
      prompt.context.removeComment(owner)
      prompt.context.add({ type: "file", path: item.path, selection: item.selection, preview: item.preview })
    },
    hasUnowned(file) {
      return prompt.context.items().some((item) => item.type === "file" && !item.commentID && sameFile(item, file))
    },
    owned,
  }
}

/** Matches the chip identity the store dedupes on: path plus selected lines, ignoring characters and preview. */
export function sameFile(left: ComposerAttachmentFile, right: ComposerAttachmentFile) {
  if (left.path !== right.path) return false

  if (!left.selection || !right.selection) return !left.selection && !right.selection

  return left.selection.startLine === right.selection.startLine && left.selection.endLine === right.selection.endLine
}
