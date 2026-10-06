import type { FileEntry } from '../types.ts'
import { dirname } from './path.ts'

export type FileTreeNode = FileEntry & { children: FileTreeNode[] }

export function makeTree(entries: FileEntry[]) {
  const roots: FileTreeNode[] = []
  const nodes = new Map(entries.map((entry) => [entry.path, { ...entry, children: [] } as FileTreeNode]))
  for (const node of nodes.values()) {
    const parentNode = nodes.get(dirname(node.path))
    if (parentNode && parentNode !== node) parentNode.children.push(node)
    else roots.push(node)
  }
  const sort = (items: FileTreeNode[]) => {
    items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    items.forEach((item) => sort(item.children))
  }
  sort(roots)
  return roots
}
