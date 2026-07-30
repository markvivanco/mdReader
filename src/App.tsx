/* oxlint-disable react-hooks/exhaustive-deps -- Zustand actions are stable; effects intentionally track selected scalar state. */
import { invoke } from '@tauri-apps/api/core'
import { ask, confirm, message, open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  Copy, FilePlus2, FileText, Filter, FolderOpen, FolderPlus, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Printer, RefreshCw, Save, Search, Trash2, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FileTree } from './components/FileTree'
import { MarkdownPreview } from './components/MarkdownPreview'
import { RawEditor } from './components/RawEditor'
import { dirname, displayName, isMarkdown } from './lib/path'
import { useAppStore } from './store/useAppStore'
import type { FileEntry, FileStamp, OpenDocument, SearchMatch } from './types'
import './App.css'

const api = {
  list: (root: string) => invoke<FileEntry[]>('list_folder', { root }),
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

function App() {
  const state = useAppStore()
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [itemDialog, setItemDialog] = useState<{
    action: 'file' | 'folder' | 'rename'
    value: string
  } | null>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
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

  const refresh = useCallback(async () => {
    if (!state.root) return
    setRefreshing(true)
    try {
      state.set({ entries: await api.list(state.root) })
    } catch (error) {
      await message(String(error), { title: 'Unable to refresh folder', kind: 'error' })
    } finally {
      setRefreshing(false)
    }
  }, [state.root, state.set])

  const chooseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Choose a Markdown folder' })
      if (!selected) return
      for (const document of [...state.documents]) {
        if (!(await closeDocument(document.path))) return
      }
      const entries = await api.list(selected)
      const expanded = new Set<string>(entries.filter((entry) => entry.isDir && !entry.relativePath.includes('/')).map((entry) => entry.path))
      setSelectedTypes(null)
      setFilterOpen(false)
      state.set({ root: selected, entries, expanded, documents: [], activePath: null, selectedPath: null, searchResults: [] })
    } catch (error) {
      console.error('Unable to open folder picker', error)
      await message(String(error), { title: 'Unable to open folder', kind: 'error' })
    }
  }

  const openDocument = useCallback(async (path: string, jumpLine?: number) => {
    if (!state.root || !isMarkdown(path)) {
      if (path) await invoke('open_path', { path })
      return
    }
    const existing = state.documents.find((document) => document.path === path)
    if (existing) {
      state.updateDocument(path, { mode: jumpLine ? 'raw' : existing.mode, jumpLine })
      state.set({ activePath: path, selectedPath: path })
      return
    }
    try {
      const [content, stamp] = await Promise.all([api.read(state.root, path), api.stamp(state.root, path)])
      const document: OpenDocument = { path, name: displayName(path), content, savedContent: content, stamp, mode: jumpLine ? 'raw' : 'preview', jumpLine }
      state.set({ documents: [...state.documents, document], activePath: path, selectedPath: path })
    } catch (error) {
      await message(String(error), { title: 'Unable to open file', kind: 'error' })
    }
  }, [state.root, state.documents, state.set, state.updateDocument])

  const saveDocument = useCallback(async (document = active) => {
    if (!document || !state.root) return false
    try {
      const stamp = await invoke<FileStamp>('write_text_file', { root: state.root, path: document.path, contents: document.content })
      state.updateDocument(document.path, { savedContent: document.content, stamp })
      return true
    } catch (error) {
      await message(String(error), { title: 'Unable to save file', kind: 'error' })
      return false
    }
  }, [active, state.root, state.updateDocument])

  const closeDocument = useCallback(async (path: string) => {
    const current = useAppStore.getState()
    const document = current.documents.find((item) => item.path === path)
    if (!document) return true
    if (document.content !== document.savedContent) {
      const shouldSave = await ask(`Save changes to “${document.name}” before closing?`, {
        title: 'Unsaved changes',
        kind: 'warning',
        okLabel: 'Save',
        cancelLabel: 'Review Options',
      })
      if (shouldSave && !(await saveDocument(document))) return false
      if (!shouldSave) {
        const shouldDiscard = await ask(`Discard your unsaved changes to “${document.name}”?`, {
          title: 'Discard changes?',
          kind: 'warning',
          okLabel: 'Discard',
          cancelLabel: 'Cancel',
        })
        if (!shouldDiscard) return false
      }
    }
    const latest = useAppStore.getState()
    const index = latest.documents.findIndex((item) => item.path === path)
    const remaining = latest.documents.filter((item) => item.path !== path)
    const next = remaining[Math.min(index, remaining.length - 1)]?.path || null
    latest.set({ documents: remaining, activePath: latest.activePath === path ? next : latest.activePath })
    return true
  }, [saveDocument])

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
        await invoke('create_item', { root: state.root, path: `${parent}/${finalName}`, directory: action === 'folder' })
        await refresh()
        if (action === 'file') await openDocument(`${parent}/${finalName}`)
      } else if (action === 'rename' && selected) {
        const name = suppliedName?.trim()
        if (!name || name === selected.name) return
        const newPath = await invoke<string>('rename_item', { root: state.root, path: selected.path, newName: name })
        const documents = state.documents.map((document) => {
          if (document.path !== selected.path && !document.path.startsWith(`${selected.path}/`)) return document
          const path = `${newPath}${document.path.slice(selected.path.length)}`
          return { ...document, path, name: displayName(path) }
        })
        const activePath = state.activePath?.startsWith(selected.path) ? `${newPath}${state.activePath.slice(selected.path.length)}` : state.activePath
        state.set({ documents, activePath, selectedPath: newPath })
        await refresh()
      } else if (action === 'duplicate' && selected) {
        const newPath = await invoke<string>('duplicate_item', { root: state.root, path: selected.path })
        await refresh()
        state.set({ selectedPath: newPath })
      } else if (action === 'trash' && selected) {
        if (!(await confirm(`Move “${selected.name}” to Trash?`, { title: 'Move to Trash', kind: 'warning' }))) return
        const affected = state.documents.filter((document) => document.path === selected.path || document.path.startsWith(`${selected.path}/`))
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
      const newPath = await invoke<string>('move_item', { root: state.root, path: source, destinationDir: destination })
      const documents = state.documents.map((document) => {
        if (document.path !== source && !document.path.startsWith(`${source}/`)) return document
        const path = `${newPath}${document.path.slice(source.length)}`
        return { ...document, path, name: displayName(path) }
      })
      const activePath = state.activePath?.startsWith(source) ? `${newPath}${state.activePath.slice(source.length)}` : state.activePath
      state.set({ documents, activePath, selectedPath: newPath })
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

  const submitItemDialog = (event: FormEvent) => {
    event.preventDefault()
    if (!itemDialog?.value.trim()) return
    const pending = itemDialog
    setItemDialog(null)
    void performItemAction(pending.action, pending.value)
  }

  const exportActiveDocument = async () => {
    if (!active || printing) return
    setPrinting(true)
    try {
      const title = pdfFileName(active.name)
      document.title = title
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await invoke('print_active_document', { title })
    } catch (error) {
      console.error('Unable to print active document', error)
      await message(String(error), { title: 'Unable to save PDF', kind: 'error' })
    } finally {
      setPrinting(false)
    }
  }

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
    if (!state.root || !state.documents.length) return
    const timer = window.setInterval(async () => {
      for (const document of useAppStore.getState().documents) {
        try {
          const stamp = await api.stamp(state.root!, document.path)
          if (stamp.modifiedMs === document.stamp.modifiedMs && stamp.size === document.stamp.size) continue
          if (document.content === document.savedContent) {
            const content = await api.read(state.root!, document.path)
            state.updateDocument(document.path, { content, savedContent: content, stamp })
          } else {
            const reload = await ask(`“${document.name}” changed on disk while you have unsaved edits. Reload it and discard your edits?`, {
              title: 'File conflict', kind: 'warning', okLabel: 'Reload', cancelLabel: 'Keep My Edits',
            })
            if (reload) {
              const content = await api.read(state.root!, document.path)
              state.updateDocument(document.path, { content, savedContent: content, stamp })
            } else state.updateDocument(document.path, { stamp })
          }
        } catch {
          // A rename or deletion is handled when the user next interacts with the document.
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [state.root, state.documents.length, state.updateDocument])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDocument()
      }
      if (event.metaKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        state.set({ searchOpen: true })
      }
      if (event.metaKey && event.key.toLowerCase() === 'w' && state.activePath) {
        event.preventDefault()
        void closeDocument(state.activePath)
      }
    }
    window.addEventListener('keydown', handleKey)
    let unlisten: (() => void) | undefined
    void getCurrentWindow().onCloseRequested(async (event) => {
      const dirty = useAppStore.getState().documents.filter((document) => document.content !== document.savedContent)
      if (!dirty.length) return
      event.preventDefault()
      for (const document of dirty) if (!(await closeDocument(document.path))) return
      await getCurrentWindow().destroy()
    }).then((value) => { unlisten = value })
    return () => {
      window.removeEventListener('keydown', handleKey)
      unlisten?.()
    }
  }, [closeDocument, saveDocument, state.activePath, state.set])

  const openPaths = useMemo(() => new Set(state.documents.map((document) => document.path)), [state.documents])

  return (
    <main className="app-shell">
      <header className="toolbar">
        <button className="icon-button" onClick={() => setSidebarVisible(!sidebarVisible)} title="Toggle sidebar">
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <button className="folder-button" onClick={chooseFolder}><FolderOpen size={17} /> {state.root ? displayName(state.root) : 'Open Folder'}</button>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => state.set({ searchOpen: !state.searchOpen })} title="Search (⌘F)"><Search size={18} /></button>
        <button className="icon-button" onClick={() => void saveDocument()} disabled={!active || active.content === active.savedContent} title="Save (⌘S)"><Save size={18} /></button>
        <button className="icon-button" onClick={() => void exportActiveDocument()} disabled={!active || printing} title={printing ? 'Opening print dialog…' : 'Save active document to PDF'}>
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
                    title="Filter by file type"
                    aria-expanded={filterOpen}
                  >
                    <Filter size={15} />
                  </button>
                  {filterOpen && (
                    <div className="filter-menu">
                      <div className="filter-menu-heading">
                        <strong>File types</strong>
                        <button onClick={() => setSelectedTypes(null)}>All</button>
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
                        {selectedTypes === null ? 'Showing all types' : `${selectedTypes.size} of ${availableTypes.length} selected`}
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
                      <button className="danger" onClick={() => { setMenuOpen(false); void performItemAction('trash') }}><Trash2 size={14} /> Move to Trash</button>
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
              <div className="empty-sidebar"><FolderOpen size={32} /><p>Choose a folder to browse its Markdown files and assets.</p><button onClick={chooseFolder}>Open Folder</button></div>
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
            <nav className="tabs">
              {state.documents.map((document) => (
                <button key={document.path} className={`tab ${document.path === state.activePath ? 'active' : ''}`} onClick={() => state.set({ activePath: document.path })}>
                  <FileText size={14} />
                  <span>{document.name}</span>
                  {document.content !== document.savedContent && <i />}
                  <span
                    role="button"
                    className="mode-toggle"
                    title={document.mode === 'preview' ? 'Show raw Markdown' : 'Show rendered preview'}
                    onClick={(event) => {
                      event.stopPropagation()
                      state.updateDocument(document.path, { mode: document.mode === 'preview' ? 'raw' : 'preview' })
                      state.set({ activePath: document.path })
                    }}
                  >
                    {document.mode === 'preview' ? 'Preview' : 'Raw'}
                  </span>
                  <X className="tab-close" size={14} onClick={(event) => { event.stopPropagation(); void closeDocument(document.path) }} />
                </button>
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
              {active.mode === 'raw' ? (
                <RawEditor
                  value={active.content}
                  onChange={(content) => state.updateDocument(active.path, { content })}
                  jumpLine={active.jumpLine}
                  searchQuery={state.searchOpen ? state.searchQuery : ''}
                  onJumpComplete={() => state.updateDocument(active.path, { jumpLine: undefined })}
                />
              ) : (
                <div className="preview-scroll">
                  <MarkdownPreview content={active.content} path={active.path} onOpenMarkdown={(path) => void openDocument(path)} />
                </div>
              )}
            </section>
          ) : (
            <section className="welcome">
              <div className="app-mark">md</div>
              <h1>mdReader</h1>
              <p>Read, search, edit, and export Markdown without leaving your desktop.</p>
              <button onClick={chooseFolder}><FolderOpen size={18} /> Open a Folder</button>
              <small>⌘F to search · ⌘S to save · drag files between folders to move</small>
            </section>
          )}
        </section>
      </section>
      {active && <footer className="statusbar"><span>{active.path}</span><span>{active.content.split(/\s+/).filter(Boolean).length.toLocaleString()} words · {active.content.split('\n').length.toLocaleString()} lines</span></footer>}
      <div className="print-document">{active && <MarkdownPreview content={active.content} path={active.path} onOpenMarkdown={() => {}} />}</div>
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
