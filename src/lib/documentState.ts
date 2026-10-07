import type { FileStamp, OpenDocument } from '../types'

export type DocumentSurface = 'preview' | 'rich-editor' | 'raw-editor'

type DocumentViewState = Pick<OpenDocument, 'mode' | 'editing' | 'jumpLine'>

type OpenDocumentInput = {
  root: string
  path: string
  name: string
  content: string
  stamp: FileStamp
  jumpLine?: number
}

export function documentViewState(jumpLine?: number): DocumentViewState {
  return {
    mode: jumpLine === undefined ? 'preview' : 'raw',
    editing: false,
    jumpLine,
  }
}

export function createOpenDocument({
  root,
  path,
  name,
  content,
  stamp,
  jumpLine,
}: OpenDocumentInput): OpenDocument {
  return {
    root,
    path,
    name,
    content,
    savedContent: content,
    stamp,
    ...documentViewState(jumpLine),
  }
}

export function selectDocumentSurface(
  document: Pick<OpenDocument, 'mode' | 'editing'>,
): DocumentSurface {
  if (document.mode === 'raw') return 'raw-editor'
  return document.editing ? 'rich-editor' : 'preview'
}
