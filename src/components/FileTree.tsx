import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from 'lucide-react'
import { isMarkdown } from '../lib/path'
import { makeTree, type FileTreeNode } from '../lib/fileTree'
import type { FileEntry } from '../types'

export function FileTree({
  entries,
  expanded,
  selectedPath,
  openPaths,
  onToggle,
  onSelect,
  onOpen,
  onMove,
}: {
  entries: FileEntry[]
  expanded: Set<string>
  selectedPath: string | null
  openPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onOpen: (entry: FileEntry) => void
  onMove: (source: string, destination: string) => void
}) {
  const render = (node: FileTreeNode, depth: number) => {
    const isExpanded = expanded.has(node.path)
    const Icon = node.isDir ? (isExpanded ? FolderOpen : Folder) : isMarkdown(node.path) ? FileText : File
    return (
      <div key={node.path}>
        <button
          className={`tree-row ${selectedPath === node.path ? 'selected' : ''} ${openPaths.has(node.path) ? 'open' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          draggable
          onDragStart={(event) => event.dataTransfer.setData('text/mdreader-path', node.path)}
          onDragOver={(event) => node.isDir && event.preventDefault()}
          onDrop={(event) => {
            if (!node.isDir) return
            event.preventDefault()
            const source = event.dataTransfer.getData('text/mdreader-path')
            if (source && source !== node.path) onMove(source, node.path)
          }}
          onClick={() => {
            onSelect(node.path)
            if (node.isDir) onToggle(node.path)
            else onOpen(node)
          }}
          onDoubleClick={() => node.isDir && onToggle(node.path)}
          title={node.relativePath}
        >
          {node.isDir ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="tree-spacer" />}
          <Icon size={15} />
          <span>{node.name}</span>
        </button>
        {node.isDir && isExpanded && node.children.map((child) => render(child, depth + 1))}
      </div>
    )
  }
  return <div className="file-tree">{makeTree(entries).map((node) => render(node, 0))}</div>
}
