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

export type SearchMatch = {
  path: string
  relativePath: string
  line: number
  column: number
  excerpt: string
}

export type OpenDocument = {
  path: string
  name: string
  content: string
  savedContent: string
  mode: 'preview' | 'raw'
  stamp: FileStamp
  jumpLine?: number
}
