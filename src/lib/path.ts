export const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkd']

export function isMarkdown(path: string) {
  return markdownExtensions.some((extension) => path.toLowerCase().endsWith(extension))
}

export function dirname(path: string) {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

export function resolveRelative(baseFile: string, target: string) {
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(target)) return target
  if (target.startsWith('/')) return target
  const parts = `${dirname(baseFile)}/${decodeURIComponent(target)}`.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `/${normalized.join('/')}`
}

export function displayName(path: string) {
  return path.split('/').pop() || path
}
