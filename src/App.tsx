/* oxlint-disable react-hooks/exhaustive-deps -- Zustand actions are stable; effects intentionally track selected scalar state. */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ask, confirm, message, open } from '@tauri-apps/plugin-dialog'
import {
  Check, Code2, Copy, Eye, FilePlus2, FileText, Filter, FolderOpen, FolderPlus, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Pencil, Printer, RefreshCw, Save, Search, Trash2, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FileTree } from './components/FileTree'
import { MarkdownPreview } from './components/MarkdownPreview'
import { RawEditor } from './components/RawEditor'
import { RichMarkdownEditor, type RichMarkdownEditorHandle } from './components/RichMarkdownEditor'
import { createOpenDocument, documentViewState, selectDocumentSurface } from './lib/documentState'
import { createOpenFileReceiver, type OpenFileRequest } from './lib/openFiles'
import { dirname, displayName, isMarkdown, isPathWithin, rebasePath, samePath } from './lib/path'
import { desktopPlatform, primaryModifier, shortcutLabel, trashName } from './lib/platform'
import { printInWebview } from './lib/printing'
import { markdownEnvelope } from './lib/markdownEnvelope'
import { coordinateQuitReview, type QuitReviewDocumentChoice, type QuitReviewInitialChoice } from './lib/quitReview'
import { useAppStore } from './store/useAppStore'
import type { FileEntry, FileStamp, FolderListing, OpenDocument, SearchMatch } from './types'
import './App.css'

type PrintDocumentSnapshot = Readonly<Pick<OpenDocument, 'content' | 'name' | 'path'>>

type CloseRequestPayload = {
  requestId: number
}

type CloseListenerReadyResponse = {
  listenerId: number
}

const REVIEW_AND_SAVE_LABEL = 'Review & Save'
const QUIT_WITHOUT_SAVING_LABEL = 'Quit Without Saving'
const SAVE_LABEL = 'Save'
const DONT_SAVE_LABEL = 'Don’t Save'
const CANCEL_LABEL = 'Cancel'

const api = {
  list: (root: string) => invoke<FolderListing>('list_folder', { root }),
  read: (root: string, path: string) => invoke<string>('read_text_file', { root, path }),
  stamp: (root: string, path: string) => invoke<FileStamp>('file_stamp', { root, path }),
}

function pdfFileName(markdownName: string) {
  return `${markdownName.replace(/\.(md|markdown|mdown|mkd)$/i, '')}.pdf`
}

function fileType(entry: FileEntry) {
  const dot = entry.name.lastIndexOf('.')
  return dot > 0 ? entry.name.slice(dot).toLowerCase() : 'No extension'
}

async function chooseQuitAction(documents: readonly OpenDocument[]): Promise<QuitReviewInitialChoice> {
  const count = documents.length
  const noun = count === 1 ? 'document has' : 'documents have'
  const choice = await message(
    `${count} ${noun} unsaved changes. Would you like to review and save ${count === 1 ? 'it' : 'them'} before quitting?`,
    {
      title: 'Unsaved changes',
      kind: 'warning',
      buttons: {
        yes: REVIEW_AND_SAVE_LABEL,
        no: QUIT_WITHOUT_SAVING_LABEL,
        cancel: CANCEL_LABEL,
      },
    },
  )
  if (choice === REVIEW_AND_SAVE_LABEL) return 'review'
  if (choice === QUIT_WITHOUT_SAVING_LABEL) return 'discard-all'
  return 'cancel'
}

async function chooseDocumentAction(
  document: OpenDocument,
  index?: number,
  total?: number,
): Promise<QuitReviewDocumentChoice> {
  const progress = index === undefined || total === undefined
    ? ''
    : `\n\nDocument ${index + 1} of ${total}`
  const choice = await message(
    `Save changes to “${document.name}”?\n\n${document.path}${progress}`,
    {
      title: 'Unsaved changes',
      kind: 'warning',
      buttons: { yes: SAVE_LABEL, no: DONT_SAVE_LABEL, cancel: CANCEL_LABEL },
    },
  )
  if (choice === SAVE_LABEL) return 'save'
  if (choice === DONT_SAVE_LABEL) return 'discard'
  return 'cancel'
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function imageLabel(image: HTMLImageElement, index: number) {
  return image.alt.trim() || image.currentSrc || image.src || `image ${index + 1}`
}

async function waitForImage(image: HTMLImageElement, index: number) {
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error(`Timed out loading ${imageLabel(image, index)}`)),
        30_000,
      )
      const cleanup = () => {
        window.clearTimeout(timeout)
        image.removeEventListener('load', handleLoad)
        image.removeEventListener('error', handleError)
      }
      const handleLoad = () => {
        cleanup()
        resolve()
      }
      const handleError = () => {
        cleanup()
        reject(new Error(`Unable to load ${imageLabel(image, index)}`))
      }
      image.addEventListener('load', handleLoad, { once: true })
      image.addEventListener('error', handleError, { once: true })
    })
  }

  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(`Unable to load ${imageLabel(image, index)}`)
  }

  try {
    await image.decode()
  } catch {
    // A loaded image can reject decode() on older WebKit versions. The
    // non-zero natural dimensions above still prove that it is printable.
  }
}

async function waitForMermaidDiagrams(container: HTMLElement) {
  const expected = container.querySelectorAll('.mermaid-diagram').length
  if (!expected) return

  const startedAt = performance.now()
  while (container.querySelectorAll('.mermaid-diagram svg, .render-error').length < expected) {
    if (performance.now() - startedAt > 30_000) {
      throw new Error('Timed out rendering a Mermaid diagram')
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }

  const error = container.querySelector('.render-error')
  if (error) throw new Error(error.textContent || 'Unable to render a Mermaid diagram')
}

async function preparePrintPreview(container: HTMLElement) {
  const images = [...container.querySelectorAll<HTMLImageElement>('img')]
  await Promise.all([
    ...images.map(waitForImage),
    waitForMermaidDiagrams(container),
    document.fonts.ready,
  ])
  await nextPaint()
}

function App() {
  const state = useAppStore()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printDocument, setPrintDocument] = useState<PrintDocumentSnapshot | null>(null)
  const [itemDialog, setItemDialog] = useState<{
    action: 'file' | 'folder' | 'rename'
    value: string
  } | null>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const printDocumentRef = useRef<HTMLDivElement>(null)
  const printingRef = useRef(false)
  const richEditorRef = useRef<RichMarkdownEditorHandle>(null)
  const closingWindowRef = useRef(false)
  const choosingFolderRef = useRef(false)
  const openingFilesRef = useRef(false)
  const createMarkdownFileRef = useRef<() => Promise<void>>(async () => {})
  const exportActiveDocumentRef = useRef<() => Promise<void>>(async () => {})
  const active = state.documents.find((document) => document.path === state.activePath) || null
  const availableTypes = useMemo(
    () => [...new Set(state.entries.filter((entry) => !entry.isDir).map(fileType))].sort(),
    [state.entries],
  )
  const visibleEntries = useMemo(() => {
    if (selectedTypes === null) return state.entries
    const entriesByPath = new Map(state.entries.map((entry) => [entry.path, entry]))
    const visiblePaths = new Set<string>()
    for (const entry of state.entries) {
      if (entry.isDir || !selectedTypes.has(fileType(entry))) continue
      visiblePaths.add(entry.path)
      let parent = dirname(entry.path)
      while (entriesByPath.has(parent)) {
        visiblePaths.add(parent)
        parent = dirname(parent)
      }
    }
    return state.entries.filter((entry) => visiblePaths.has(entry.path))
  }, [state.entries, selectedTypes])

  useEffect(() => {
    document.title = active ? pdfFileName(active.name) : 'mdReader'
  }, [active?.name])

  const flushDocument = useCallback(async (
    path: string,
    options?: { preserveFocus?: boolean },
  ) => {
    const current = useAppStore.getState()
    const document = current.documents.find((item) => item.path === path)
    if (!document) return null
    const richEditor = richEditorRef.current
    if (
      current.activePath !== path
      || !document.editing
      || document.mode !== 'preview'
      || !richEditor
      || richEditor.path !== path
    ) {
      return document
    }

    try {
      const content = await richEditor.flush(options)
      const latest = useAppStore.getState()
      const latestDocument = latest.documents.find((item) => item.path === path)
      if (!latestDocument) return null
      if (latestDocument.content !== content) latest.updateDocument(path, { content })
      return { ...latestDocument, content }
    } catch (error) {
      console.error('Unable to collect rich editor changes', error)
      try {
        await message(String(error), { title: 'Unable to apply editor changes', kind: 'error' })
      } catch (dialogError) {
        console.error('Unable to show editor error', dialogError)
      }
      return null
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!state.root) return
    setRefreshing(true)
    try {
      state.set({ entries: (await api.list(state.root)).entries })
    } catch (error) {
      await message(String(error), { title: 'Unable to refresh folder', kind: 'error' })
    } finally {
      setRefreshing(false)
    }
  }, [state.root, state.set])

  const chooseFolder = async () => {
    if (openingFilesRef.current || choosingFolderRef.current) return false
    choosingFolderRef.current = true
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose a Markdown folder' })
      if (!selected) return false
      for (const document of [...state.documents]) {
        if (!(await closeDocument(document.path))) return false
      }
      const { root, entries } = await api.list(selected)
      const expanded = new Set<string>(entries.filter((entry) => entry.isDir && samePath(dirname(entry.path), root)).map((entry) => entry.path))
      setSelectedTypes(null)
      setFilterOpen(false)
      state.set({ root, entries, expanded, documents: [], activePath: null, selectedPath: null, searchResults: [] })
      return true
    } catch (error) {
      console.error('Unable to open folder picker', error)
      await message(String(error), { title: 'Unable to open folder', kind: 'error' })
      return false
    } finally {
      choosingFolderRef.current = false
    }
  }

  const openDocument = useCallback(async (path: string, jumpLine?: number, suppliedRoot?: string) => {
    const current = useAppStore.getState()
    const activeDocument = current.documents.find((document) => document.path === current.activePath)
    const root = suppliedRoot ?? (current.root && isPathWithin(path, current.root)
      ? current.root : activeDocument?.root ?? current.root)
    if (!root || !isMarkdown(path)) {
      if (path) await invoke('open_path', { path })
      return
    }
    try {
      // The dialog, links, drive-letter case and Rust's verbatim paths can spell
      // one file differently. Use native identity before selecting/creating tabs.
      path = await invoke<string>('resolve_document_path', { root, path })
    } catch (error) {
      await message(String(error), { title: 'Unable to open file', kind: 'error' })
      return
    }
    if (useAppStore.getState().root !== current.root) return
    if (
      current.activePath
      && current.activePath !== path
      && !(await flushDocument(current.activePath))
    ) return
    const latest = useAppStore.getState()
    const existing = latest.documents.find((document) => document.path === path)
    if (existing) {
      if (
        jumpLine !== undefined
        && latest.activePath === path
        && existing.editing
        && existing.mode === 'preview'
        && !(await flushDocument(path))
      ) return
      const afterFlush = useAppStore.getState()
      afterFlush.updateDocument(path, jumpLine === undefined
        ? { jumpLine }
        : documentViewState(jumpLine))
      afterFlush.set({ activePath: path, selectedPath: path })
      return
    }
    try {
      const [content, stamp] = await Promise.all([api.read(root, path), api.stamp(root, path)])
      const document = createOpenDocument({ root, path, name: displayName(path), content, stamp, jumpLine })
      const afterRead = useAppStore.getState()
      if (afterRead.root !== latest.root) return
      const documents = afterRead.documents.some((openDocument) => openDocument.path === path)
        ? afterRead.documents
        : [...afterRead.documents, document]
      afterRead.set({ documents, activePath: path, selectedPath: path })
    } catch (error) {
      await message(String(error), { title: 'Unable to open file', kind: 'error' })
    }
  }, [flushDocument])

  const openRequestedDocument = useCallback(async (request: OpenFileRequest) => {
    openingFilesRef.current = true
    try {
      const file = await invoke<{ root: string; path: string }>('resolve_open_file', { requestId: request.id })
      if (!useAppStore.getState().root) {
        // Only the first OS-opened file chooses a sidebar folder. Later opens
        // keep the user's workspace and unsaved tabs, even across directories.
        const folder = await api.list(file.root)
        useAppStore.getState().set({ ...folder, expanded: new Set<string>() })
      }
      const workspaceRoot = useAppStore.getState().root!
      await openDocument(file.path, undefined, isPathWithin(file.path, workspaceRoot) ? workspaceRoot : file.root)
    } finally {
      openingFilesRef.current = false
    }
  }, [openDocument])

  const [fileReceiver] = useState(() => createOpenFileReceiver({
    subscribe: (notify) => listen('open-files-pending', notify),
    pending: () => invoke<OpenFileRequest[]>('pending_open_files'),
    open: openRequestedDocument,
    acknowledge: (requestId) => invoke('acknowledge_open_file', { requestId }),
    canOpen: () => !closingWindowRef.current && !choosingFolderRef.current,
    reportError: async (error) => { await message(String(error), { title: 'Unable to open file', kind: 'error' }) },
  }))

  useEffect(() => {
    fileReceiver.start()
    return () => fileReceiver.stop()
  }, [fileReceiver])

  const saveDocument = useCallback(async (requestedDocument?: OpenDocument | null) => {
    const current = useAppStore.getState()
    const target = requestedDocument
      ?? current.documents.find((document) => document.path === current.activePath)
      ?? null
    if (!target) return false
    const document = await flushDocument(target.path, { preserveFocus: true })
    if (!document) return false
    try {
      const stamp = await invoke<FileStamp>('write_text_file', { root: document.root, path: document.path, contents: document.content })
      useAppStore.getState().updateDocument(document.path, { savedContent: document.content, stamp })
      return true
    } catch (error) {
      await message(String(error), { title: 'Unable to save file', kind: 'error' })
      return false
    }
  }, [flushDocument])

  const closeDocument = useCallback(async (path: string) => {
    if (!useAppStore.getState().documents.some((document) => document.path === path)) return true
    const document = await flushDocument(path)
    if (!document) return false
    if (document.content !== document.savedContent) {
      const action = await chooseDocumentAction(document)
      if (action === 'cancel') return false
      if (action === 'save' && !(await saveDocument(document))) return false
    }
    const latest = useAppStore.getState()
    const index = latest.documents.findIndex((item) => item.path === path)
    const remaining = latest.documents.filter((item) => item.path !== path)
    const next = remaining[Math.min(index, remaining.length - 1)]?.path || null
    latest.set({ documents: remaining, activePath: latest.activePath === path ? next : latest.activePath })
    return true
  }, [flushDocument, saveDocument])

  const activateDocument = useCallback(async (path: string) => {
    const current = useAppStore.getState()
    if (
      current.activePath
      && current.activePath !== path
      && !(await flushDocument(current.activePath))
    ) return
    useAppStore.getState().set({ activePath: path })
  }, [flushDocument])

  const switchDocumentMode = useCallback(async (path: string, mode: OpenDocument['mode']) => {
    const current = useAppStore.getState()
    if (
      current.activePath
      && current.activePath !== path
      && !(await flushDocument(current.activePath))
    ) return
    const latest = useAppStore.getState()
    const document = latest.documents.find((item) => item.path === path)
    if (!document) return
    if (latest.activePath === path && document.editing && document.mode === 'preview' && mode !== 'preview') {
      if (!(await flushDocument(path))) return
    }
    const afterFlush = useAppStore.getState()
    afterFlush.updateDocument(path, { mode })
    afterFlush.set({ activePath: path })
  }, [flushDocument])

  const setDocumentEditing = useCallback(async (path: string, editing: boolean) => {
    const current = useAppStore.getState()
    if (
      current.activePath
      && current.activePath !== path
      && !(await flushDocument(current.activePath))
    ) return
    const document = useAppStore.getState().documents.find((item) => item.path === path)
    if (!document || document.editing === editing) return
    if (!editing && document.mode === 'preview' && !(await flushDocument(path))) return
    const latest = useAppStore.getState()
    latest.updateDocument(path, { editing })
    latest.set({ activePath: path })
  }, [flushDocument])

  const performItemAction = async (
    action: 'file' | 'folder' | 'rename' | 'duplicate' | 'trash',
    suppliedName?: string,
  ) => {
    if (!state.root) return
    const selected = state.entries.find((entry) => entry.path === state.selectedPath)
    const parent = selected?.isDir ? selected.path : selected ? dirname(selected.path) : state.root
    try {
      if (action === 'file' || action === 'folder') {
        const name = suppliedName?.trim()
        if (!name) return
        const finalName = action === 'file' && !isMarkdown(name) ? `${name}.md` : name
        const newPath = await invoke<string>('create_item', { root: state.root, parent, name: finalName, directory: action === 'folder' })
        await refresh()
        if (action === 'file') await openDocument(newPath)
      } else if (action === 'rename' && selected) {
        const name = suppliedName?.trim()
        if (!name || name === selected.name) return
        const activePathBeforeRename = useAppStore.getState().activePath
        if (activePathBeforeRename && isPathWithin(activePathBeforeRename, selected.path)
          && !(await flushDocument(activePathBeforeRename))) return
        const newPath = await invoke<string>('rename_item', { root: state.root, path: selected.path, newName: name })
        const current = useAppStore.getState()
        const documents = current.documents.map((document) => {
          const path = rebasePath(document.path, selected.path, newPath)
          if (path === document.path) return document
          return { ...document, root: state.root!, path, name: displayName(path) }
        })
        const activePath = current.activePath ? rebasePath(current.activePath, selected.path, newPath) : null
        const expanded = new Set([...current.expanded].map((path) => rebasePath(path, selected.path, newPath)))
        state.set({ documents, activePath, expanded, selectedPath: newPath })
        await refresh()
      } else if (action === 'duplicate' && selected) {
        const newPath = await invoke<string>('duplicate_item', { root: state.root, path: selected.path })
        await refresh()
        state.set({ selectedPath: newPath })
      } else if (action === 'trash' && selected) {
        if (!(await confirm(`Move “${selected.name}” to ${trashName}?`, { title: `Move to ${trashName}`, kind: 'warning' }))) return
        const affected = state.documents.filter((document) => isPathWithin(document.path, selected.path))
        for (const document of affected) if (!(await closeDocument(document.path))) return
        await invoke('trash_item', { root: state.root, path: selected.path })
        state.set({ selectedPath: null })
        await refresh()
      }
    } catch (error) {
      await message(String(error), { title: 'File operation failed', kind: 'error' })
    }
  }

  const moveItem = async (source: string, destination: string) => {
    if (!state.root) return
    try {
      const activePathBeforeMove = useAppStore.getState().activePath
      if (activePathBeforeMove && isPathWithin(activePathBeforeMove, source)
        && !(await flushDocument(activePathBeforeMove))) return
      const newPath = await invoke<string>('move_item', { root: state.root, path: source, destinationDir: destination })
      const current = useAppStore.getState()
      const documents = current.documents.map((document) => {
        const path = rebasePath(document.path, source, newPath)
        if (path === document.path) return document
        return { ...document, root: state.root!, path, name: displayName(path) }
      })
      const activePath = current.activePath ? rebasePath(current.activePath, source, newPath) : null
      const expanded = new Set([...current.expanded].map((path) => rebasePath(path, source, newPath)))
      expanded.add(destination)
      state.set({ documents, activePath, expanded, selectedPath: newPath })
      await refresh()
    } catch (error) {
      await message(String(error), { title: 'Unable to move item', kind: 'error' })
    }
  }

  const openItemDialog = (action: 'file' | 'folder' | 'rename') => {
    const selected = state.entries.find((entry) => entry.path === state.selectedPath)
    if (action === 'rename' && !selected) return
    setMenuOpen(false)
    setItemDialog({
      action,
      value: action === 'file' ? 'untitled.md' : action === 'folder' ? 'New Folder' : selected!.name,
    })
  }

  const createMarkdownFile = async () => {
    const current = useAppStore.getState()
    if (current.activePath && !(await flushDocument(current.activePath))) return
    if (!state.root && !(await chooseFolder())) return
    openItemDialog('file')
  }
  createMarkdownFileRef.current = createMarkdownFile

  const submitItemDialog = (event: FormEvent) => {
    event.preventDefault()
    if (!itemDialog?.value.trim()) return
    const pending = itemDialog
    setItemDialog(null)
    void performItemAction(pending.action, pending.value)
  }

  const exportActiveDocument = async () => {
    if (!active || printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    try {
      const documentToPrint = await flushDocument(active.path)
      if (!documentToPrint) return
      const snapshot: PrintDocumentSnapshot = {
        content: documentToPrint.content,
        name: documentToPrint.name,
        path: documentToPrint.path,
      }
      setPrintDocument(snapshot)
      const title = pdfFileName(snapshot.name)
      document.title = title
      await nextPaint()
      if (!printDocumentRef.current) throw new Error('The rendered print preview is unavailable')
      await preparePrintPreview(printDocumentRef.current)
      if (desktopPlatform() === 'windows') await printInWebview(window)
      else await invoke('print_active_document', { title })
    } catch (error) {
      console.error('Unable to print active document', error)
      await message(String(error), { title: 'Unable to save PDF', kind: 'error' })
    } finally {
      setPrintDocument(null)
      setPrinting(false)
      printingRef.current = false
    }
  }
  exportActiveDocumentRef.current = exportActiveDocument

  const reviewAppCloseRequest = useCallback(async (requestId: number) => {
    if (closingWindowRef.current) return
    closingWindowRef.current = true
    let shouldClose = false
    try {
      const current = useAppStore.getState()
      if (current.activePath && !(await flushDocument(current.activePath))) return
      const latest = useAppStore.getState()
      const dirty = latest.documents.filter((document) => document.content !== document.savedContent)
      const result = await coordinateQuitReview({
        documents: dirty,
        chooseInitialAction: chooseQuitAction,
        chooseDocumentAction: async (document, index, total) => {
          const openState = useAppStore.getState()
          openState.set({ activePath: document.path, selectedPath: document.path })
          await nextPaint()
          return chooseDocumentAction(document, index, total)
        },
        saveDocument: async (document) => {
          const currentDocument = useAppStore.getState().documents.find((item) => item.path === document.path)
          return currentDocument ? saveDocument(currentDocument) : false
        },
      })
      shouldClose = result.shouldQuit
    } catch (error) {
      console.error('Unable to review unsaved changes', error)
      try {
        await message(String(error), { title: 'Unable to quit safely', kind: 'error' })
      } catch (dialogError) {
        console.error('Unable to show quit error', dialogError)
      }
    } finally {
      try {
        await invoke('resolve_close_request', { requestId, shouldClose })
      } catch (error) {
        console.error('Unable to resolve the close request', error)
      }
      closingWindowRef.current = false
    }
  }, [flushDocument, saveDocument])

  useEffect(() => {
    if (!menuOpen) return
    const dismissMenu = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', dismissMenu, true)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.removeEventListener('pointerdown', dismissMenu, true)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!filterOpen) return
    const dismissFilter = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false)
    }
    window.addEventListener('pointerdown', dismissFilter, true)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.removeEventListener('pointerdown', dismissFilter, true)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [filterOpen])

  useEffect(() => {
    if (!state.root || !state.searchQuery.trim()) {
      state.set({ searchResults: [] })
      return
    }
    const timer = window.setTimeout(async () => {
      if (state.searchScope === 'folder') {
        state.set({ searchResults: await invoke<SearchMatch[]>('search_folder', { root: state.root, query: state.searchQuery }) })
      } else if (active) {
        const needle = state.searchQuery.toLowerCase()
        const results: SearchMatch[] = []
        active.content.split('\n').forEach((line, index) => {
          let start = 0
          while (true) {
            const column = line.toLowerCase().indexOf(needle, start)
            if (column < 0) break
            results.push({ path: active.path, relativePath: active.name, line: index + 1, column: column + 1, excerpt: line.trim() })
            start = column + Math.max(needle.length, 1)
          }
        })
        state.set({ searchResults: results })
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [state.root, state.searchQuery, state.searchScope, active?.content, active?.path])

  useEffect(() => {
    if (!state.documents.length) return
    const timer = window.setInterval(async () => {
      if (closingWindowRef.current) return
      for (const document of useAppStore.getState().documents) {
        try {
          const stamp = await api.stamp(document.root, document.path)
          if (stamp.modifiedMs === document.stamp.modifiedMs && stamp.size === document.stamp.size) continue
          const localDocument = await flushDocument(document.path)
          if (!localDocument) continue
          if (localDocument.content === localDocument.savedContent) {
            const content = await api.read(localDocument.root, document.path)
            state.updateDocument(document.path, { content, savedContent: content, stamp })
          } else {
            const reload = await ask(`“${localDocument.name}” changed on disk while you have unsaved edits. Reload it and discard your edits?`, {
              title: 'File conflict', kind: 'warning', okLabel: 'Reload', cancelLabel: 'Keep My Edits',
            })
            if (reload) {
              const content = await api.read(localDocument.root, document.path)
              state.updateDocument(document.path, { content, savedContent: content, stamp })
            } else state.updateDocument(document.path, { stamp })
          }
        } catch {
          // A rename or deletion is handled when the user next interacts with the document.
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [flushDocument, state.root, state.documents.length, state.updateDocument])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (primaryModifier(event) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void exportActiveDocumentRef.current()
      }
      if (primaryModifier(event) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDocument()
      }
      if (primaryModifier(event) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createMarkdownFileRef.current()
      }
      if (primaryModifier(event) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const current = useAppStore.getState()
        void (async () => {
          if (current.activePath && !(await flushDocument(current.activePath))) return
          useAppStore.getState().set({ searchOpen: true })
        })()
      }
      if (primaryModifier(event) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (state.activePath) void closeDocument(state.activePath)
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [closeDocument, flushDocument, saveDocument, state.activePath])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    let listenerId: number | undefined

    const markListenerUnready = (id: number) => {
      void invoke('close_listener_unready', { listenerId: id }).catch((error) => {
        console.error('Unable to unregister the close listener', error)
      })
    }

    void listen<CloseRequestPayload>('app-close-requested', (event) => {
      void (async () => {
        if (closingWindowRef.current) return
        try {
          const acknowledged = await invoke<boolean>('ack_close_request', {
            requestId: event.payload.requestId,
          })
          if (!acknowledged) return
        } catch (error) {
          console.error('Unable to acknowledge the close request', error)
          return
        }
        await reviewAppCloseRequest(event.payload.requestId)
      })()
    }).then(async (value) => {
      if (disposed) value()
      else {
        unlisten = value
        try {
          const registration = await invoke<CloseListenerReadyResponse>('close_listener_ready')
          if (disposed) markListenerUnready(registration.listenerId)
          else listenerId = registration.listenerId
        } catch (error) {
          console.error('Unable to register the close listener', error)
        }
      }
    }).catch((error) => {
      console.error('Unable to register the close listener', error)
    })
    return () => {
      disposed = true
      unlisten?.()
      if (listenerId !== undefined) markListenerUnready(listenerId)
    }
  }, [reviewAppCloseRequest])

  const openPaths = useMemo(() => new Set(state.documents.map((document) => document.path)), [state.documents])
  const activeSurface = active ? selectDocumentSurface(active) : null

  return (
    <main className="app-shell">
      <header className="toolbar">
        <button className="icon-button" onClick={() => setSidebarVisible(!sidebarVisible)} title="Toggle sidebar">
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <button className="folder-button" onClick={chooseFolder}><FolderOpen size={17} /> {state.root ? displayName(state.root) : 'Open Folder'}</button>
        <span className="toolbar-spacer" />
        {active && (
          <>
            <div className="editor-mode-switch" role="group" aria-label="Document mode">
              <button
                className={active.mode === 'preview' ? 'active' : ''}
                onClick={() => void switchDocumentMode(active.path, 'preview')}
                aria-pressed={active.mode === 'preview'}
                title={active.editing ? 'Edit with formatting' : 'View rendered Markdown'}
              >
                <Eye size={14} /> Preview
              </button>
              <button
                className={active.mode === 'raw' ? 'active' : ''}
                onClick={() => void switchDocumentMode(active.path, 'raw')}
                aria-pressed={active.mode === 'raw'}
                title={active.editing ? 'Edit raw Markdown' : 'View raw Markdown'}
              >
                <Code2 size={14} /> Raw
              </button>
            </div>
            <button
              className={`edit-toggle${active.editing ? ' active' : ''}`}
              onClick={() => void setDocumentEditing(active.path, !active.editing)}
              aria-pressed={active.editing}
              title={active.editing ? 'Finish editing and return to read-only mode' : 'Enable editing'}
            >
              {active.editing ? <Check size={14} /> : <Pencil size={14} />}
              {active.editing ? 'Done' : 'Edit'}
            </button>
          </>
        )}
        <button className="icon-button" onClick={() => void createMarkdownFile()} title={`New Markdown file (${shortcutLabel('n')})`}><FilePlus2 size={18} /></button>
        <button className="icon-button" onClick={() => state.set({ searchOpen: !state.searchOpen })} title={`Search (${shortcutLabel('f')})`}><Search size={18} /></button>
        <button className="icon-button" onClick={() => void saveDocument()} disabled={!active} title={`Save (${shortcutLabel('s')})`}><Save size={18} /></button>
        <button className="icon-button" onClick={() => void exportActiveDocument()} disabled={!active || printing} title={printing ? 'Printing…' : `Print or save active document to PDF (${shortcutLabel('p')})`}>
          <Printer className={printing ? 'printing' : ''} size={18} />
        </button>
      </header>

      <section className="workspace">
        {sidebarVisible && (
          <aside className="sidebar" style={{ width: state.sidebarWidth }}>
            <div className="sidebar-header">
              <span>FILES</span>
              <div>
                <button onClick={() => openItemDialog('file')} disabled={!state.root} title="New Markdown file"><FilePlus2 size={15} /></button>
                <button onClick={() => openItemDialog('folder')} disabled={!state.root} title="New folder"><FolderPlus size={15} /></button>
                <button onClick={() => void refresh()} disabled={!state.root || refreshing} title={refreshing ? 'Refreshing…' : 'Refresh files'}><RefreshCw className={refreshing ? 'spinning' : ''} size={15} /></button>
                <div className="file-filter" ref={filterMenuRef}>
                  <button
                    className={selectedTypes !== null ? 'filter-active' : ''}
                    onClick={() => { setMenuOpen(false); setFilterOpen(!filterOpen) }}
                    disabled={!state.root || !availableTypes.length}
                    title="Filter by Markdown file type"
                    aria-expanded={filterOpen}
                  >
                    <Filter size={15} />
                  </button>
                  {filterOpen && (
                    <div className="filter-menu">
                      <div className="filter-menu-heading">
                        <strong>Markdown types</strong>
                        <div className="filter-bulk-actions">
                          <button onClick={() => setSelectedTypes(null)}>Select all</button>
                          <button onClick={() => setSelectedTypes(new Set())}>Deselect all</button>
                        </div>
                      </div>
                      <div className="filter-options">
                        {availableTypes.map((type) => {
                          const checked = selectedTypes === null || selectedTypes.has(type)
                          return (
                            <label key={type}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = selectedTypes === null
                                    ? new Set(availableTypes.filter((candidate) => candidate !== type))
                                    : new Set(selectedTypes)
                                  if (selectedTypes !== null) {
                                    if (next.has(type)) next.delete(type)
                                    else next.add(type)
                                  }
                                  setSelectedTypes(next.size === availableTypes.length ? null : next)
                                }}
                              />
                              <span>{type}</span>
                            </label>
                          )
                        })}
                      </div>
                      <div className="filter-summary">
                        {selectedTypes === null ? 'Showing all Markdown files' : `${selectedTypes.size} of ${availableTypes.length} selected`}
                      </div>
                    </div>
                  )}
                </div>
                <div className="file-actions" ref={fileMenuRef}>
                  <button onClick={() => setMenuOpen(!menuOpen)} disabled={!state.selectedPath} title={state.selectedPath ? 'Actions for selected item' : 'Select a file or folder for more actions'} aria-expanded={menuOpen}><MoreHorizontal size={15} /></button>
                  {menuOpen && (
                    <div className="file-menu">
                      <button onClick={() => openItemDialog('rename')}><Pencil size={14} /> Rename</button>
                      <button onClick={() => { setMenuOpen(false); void performItemAction('duplicate') }}><Copy size={14} /> Duplicate</button>
                      <button className="danger" onClick={() => { setMenuOpen(false); void performItemAction('trash') }}><Trash2 size={14} /> Move to {trashName}</button>
                    </div>
                  )}
                </div>
                <button className="collapse-sidebar" onClick={() => { setMenuOpen(false); setSidebarVisible(false) }} title="Collapse sidebar" aria-label="Collapse sidebar"><PanelLeftClose size={15} /></button>
              </div>
            </div>
            {state.root ? (
              <FileTree
                entries={visibleEntries}
                expanded={state.expanded}
                selectedPath={state.selectedPath}
                openPaths={openPaths}
                onToggle={(path) => {
                  const expanded = new Set(state.expanded)
                  if (expanded.has(path)) expanded.delete(path)
                  else expanded.add(path)
                  state.set({ expanded })
                }}
                onSelect={(selectedPath) => state.set({ selectedPath, searchOpen: false })}
                onOpen={(entry) => void openDocument(entry.path)}
                onMove={(source, destination) => void moveItem(source, destination)}
              />
            ) : (
              <div className="empty-sidebar"><FolderOpen size={32} /><p>Choose a folder to browse its Markdown files.</p><button onClick={chooseFolder}>Open Folder</button></div>
            )}
            <div
              className="resize-handle"
              onMouseDown={(event) => {
                const start = event.clientX
                const width = state.sidebarWidth
                const move = (moveEvent: MouseEvent) => state.set({ sidebarWidth: Math.max(220, Math.min(520, width + moveEvent.clientX - start)) })
                const up = () => {
                  window.removeEventListener('mousemove', move)
                  window.removeEventListener('mouseup', up)
                }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
              }}
            />
          </aside>
        )}

        <section className="content-area">
          {state.documents.length > 0 && (
            <nav className="tabs" aria-label="Open documents">
              {state.documents.map((document) => (
                <div key={document.path} className={`tab ${document.path === state.activePath ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="tab-select"
                    onClick={() => void activateDocument(document.path)}
                    aria-pressed={document.path === state.activePath}
                    aria-label={`Select ${document.name}${document.content !== document.savedContent ? ', unsaved changes' : ''}`}
                    title={document.path}
                  >
                    <FileText size={14} aria-hidden="true" />
                    <span className="tab-name">{document.name}</span>
                    {document.content !== document.savedContent && <i aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className={`mode-toggle${document.editing ? ' editing' : ''}`}
                    onClick={() => void switchDocumentMode(document.path, document.mode === 'preview' ? 'raw' : 'preview')}
                    aria-label={`Switch ${document.name} to ${document.mode === 'preview' ? 'Raw' : 'Preview'}`}
                    title={`Switch to ${document.mode === 'preview' ? 'Raw' : 'Preview'}`}
                  >
                    {document.mode === 'preview' ? 'Preview' : 'Raw'}
                  </button>
                  <button
                    type="button"
                    className="tab-close"
                    onClick={() => void closeDocument(document.path)}
                    aria-label={`Close ${document.name}`}
                    title={`Close ${document.name}`}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </nav>
          )}

          {state.searchOpen && (
            <section className="search-panel">
              <div className="search-controls">
                <Search size={16} />
                <input autoFocus value={state.searchQuery} onChange={(event) => state.set({ searchQuery: event.target.value })} placeholder="Search Markdown…" />
                <div className="scope-toggle">
                  <button className={state.searchScope === 'file' ? 'active' : ''} disabled={!active} onClick={() => state.set({ searchScope: 'file' })}>Current file</button>
                  <button className={state.searchScope === 'folder' ? 'active' : ''} disabled={!state.root} onClick={() => state.set({ searchScope: 'folder' })}>Folder</button>
                </div>
                <span>{state.searchResults.length} results</span>
                <button className="plain-icon" onClick={() => state.set({ searchOpen: false })}><X size={16} /></button>
              </div>
              {state.searchQuery && (
                <div className="search-results">
                  {state.searchResults.map((result, index) => (
                    <button key={`${result.path}:${result.line}:${result.column}:${index}`} onClick={() => void openDocument(result.path, result.line)}>
                      <strong>{result.relativePath}</strong><span>Line {result.line}:{result.column}</span><p>{result.excerpt}</p>
                    </button>
                  ))}
                  {!state.searchResults.length && <p className="no-results">No matches found.</p>}
                </div>
              )}
            </section>
          )}

          {active ? (
            <section className="document-pane">
              {activeSurface === 'raw-editor' ? (
                <RawEditor
                  value={active.content}
                  lineEnding={markdownEnvelope(active.savedContent).eol}
                  editing={active.editing}
                  onChange={(content) => {
                    if (active.editing) state.updateDocument(active.path, { content })
                  }}
                  jumpLine={active.jumpLine}
                  searchQuery={state.searchOpen ? state.searchQuery : ''}
                  onJumpComplete={() => state.updateDocument(active.path, { jumpLine: undefined })}
                />
              ) : activeSurface === 'rich-editor' ? (
                <RichMarkdownEditor
                  key={active.path}
                  ref={richEditorRef}
                  value={active.content}
                  path={active.path}
                  onChange={(content) => state.updateDocument(active.path, { content })}
                  onOpenMarkdown={(path) => void openDocument(path)}
                  onSwitchToRaw={() => void switchDocumentMode(active.path, 'raw')}
                />
              ) : (
                <div className="preview-scroll document-reader">
                  <MarkdownPreview
                    content={active.content}
                    path={active.path}
                    onOpenMarkdown={(path) => void openDocument(path)}
                  />
                </div>
              )}
            </section>
          ) : (
            <section className="welcome">
              <div className="app-mark">md</div>
              <h1>mdReader</h1>
              <p>Read, search, edit, and export Markdown without leaving your desktop.</p>
              <div className="welcome-actions">
                <button onClick={() => void createMarkdownFile()}><FilePlus2 size={18} /> New Markdown File</button>
                <button className="secondary" onClick={chooseFolder}><FolderOpen size={18} /> Open a Folder</button>
              </div>
              <small>{shortcutLabel('n')} for a new Markdown file · {shortcutLabel('f')} to search · {shortcutLabel('s')} to save</small>
            </section>
          )}
        </section>
      </section>
      {active && <footer className="statusbar"><span>{active.path}</span><span>{active.editing ? `Editing ${active.mode === 'preview' ? 'Preview' : 'Raw'}` : 'Read only'} · {active.content.split(/\s+/).filter(Boolean).length.toLocaleString()} words · {active.content.split('\n').length.toLocaleString()} lines</span></footer>}
      <div
        ref={printDocumentRef}
        className={`print-document${printing ? ' print-preparing' : ''}`}
        aria-hidden={!printDocument}
      >
        {printDocument && (
          <MarkdownPreview
            content={printDocument.content}
            path={printDocument.path}
            onOpenMarkdown={() => {}}
            forPrint
          />
        )}
      </div>
      {itemDialog && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setItemDialog(null)}>
          <form className="item-dialog" onSubmit={submitItemDialog} onPointerDown={(event) => event.stopPropagation()}>
            <h2>{itemDialog.action === 'file' ? 'New Markdown File' : itemDialog.action === 'folder' ? 'New Folder' : 'Rename Item'}</h2>
            <label htmlFor="item-name">Name</label>
            <input
              id="item-name"
              autoFocus
              value={itemDialog.value}
              onChange={(event) => setItemDialog({ ...itemDialog, value: event.target.value })}
              onFocus={(event) => {
                const dot = event.currentTarget.value.lastIndexOf('.')
                event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setItemDialog(null)
              }}
            />
            <div className="dialog-actions">
              <button type="button" onClick={() => setItemDialog(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={!itemDialog.value.trim()}>
                {itemDialog.action === 'rename' ? 'Rename' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

export default App
