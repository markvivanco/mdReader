export type FileEntry = {
  path: string
  relativePath: string
  name: string
  isDir: boolean
}

export type FileStamp = {
  modifiedMs: number
  size: number
}

export type FolderListing = {
  root: string
  entries: FileEntry[]
}

export type SearchMatch = {
  path: string
  relativePath: string
  line: number
  column: number
  excerpt: string
}

export type OpenDocument = {
  root: string
  path: string
  name: string
  content: string
  savedContent: string
  mode: 'preview' | 'raw'
  editing: boolean
  stamp: FileStamp
  jumpLine?: number
}
