import { create } from 'zustand'
import type { FileEntry, OpenDocument, SearchMatch } from '../types'

type AppState = {
  root: string | null
  entries: FileEntry[]
  documents: OpenDocument[]
  activePath: string | null
  selectedPath: string | null
  expanded: Set<string>
  sidebarWidth: number
  searchOpen: boolean
  searchScope: 'file' | 'folder'
  searchQuery: string
  searchResults: SearchMatch[]
  set: (patch: Partial<AppState>) => void
  updateDocument: (path: string, patch: Partial<OpenDocument>) => void
}

export const useAppStore = create<AppState>((set) => ({
  root: null,
  entries: [],
  documents: [],
  activePath: null,
  selectedPath: null,
  expanded: new Set<string>(),
  sidebarWidth: 300,
  searchOpen: false,
  searchScope: 'file',
  searchQuery: '',
  searchResults: [],
  set: (patch) => set(patch),
  updateDocument: (path, patch) =>
    set((state) => ({
      documents: state.documents.map((document) =>
        document.path === path ? { ...document, ...patch } : document,
      ),
    })),
}))
