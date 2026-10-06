export const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkd']

export function isMarkdown(path: string) {
  return markdownExtensions.some((extension) => path.toLowerCase().endsWith(extension))
}

// Keep the OS's spelling, case and extended-length prefix. In particular, a
// backslash in a POSIX filename is not a directory separator.
export function isWindowsPath(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
}

function parsePath(path: string) {
  const windows = isWindowsPath(path)
  const separator = windows ? '\\' : '/'
  const normalized = windows ? path.replaceAll('/', '\\') : path
  const root = windows
    ? normalized.match(/^(?:\\\\\?\\UNC\\[^\\]+\\[^\\]+(?:\\|$)|\\\\\?\\[a-z]:\\|[a-z]:\\|\\\\[^\\]+\\[^\\]+(?:\\|$))/i)?.[0] || ''
    : normalized.startsWith('/') ? '/' : ''
  return {
    root: root && !root.endsWith(separator) ? root + separator : root,
    separator,
    parts: normalized.slice(root.length).split(separator).filter(Boolean),
  }
}

function formatPath({ root, separator, parts }: ReturnType<typeof parsePath>) {
  return root + parts.join(separator) || '.'
}

export function dirname(path: string) {
  const parsed = parsePath(path)
  parsed.parts.pop()
  return formatPath(parsed)
}

export function displayName(path: string) {
  return parsePath(path).parts.at(-1) || path
}

export function joinPath(parent: string, relative: string) {
  const parsed = parsePath(parent)
  const parts = relative.split(parsed.separator === '\\' ? /[\\/]/ : '/')
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') parsed.parts.pop()
    else parsed.parts.push(part)
  }
  return formatPath(parsed)
}

// Use component boundaries, never a textual prefix (notes != notes-backup).
// Callers compare native canonical paths; do not case-fold case-sensitive dirs.
export function isPathWithin(path: string, parent: string) {
  const child = parsePath(path)
  const ancestor = parsePath(parent)
  return child.root === ancestor.root
    && child.separator === ancestor.separator
    && ancestor.parts.every((part, index) => child.parts[index] === part)
}

export function samePath(left: string, right: string) {
  return isPathWithin(left, right) && isPathWithin(right, left)
}

export function rebasePath(path: string, source: string, destination: string) {
  if (!isPathWithin(path, source)) return path
  const child = parsePath(path)
  const parent = parsePath(source)
  return joinPath(destination, child.parts.slice(parent.parts.length).join(child.separator))
}

function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    // A literal or malformed percent sequence must not crash the reader.
    return path
  }
}

export type DocumentTarget =
  | { kind: 'anchor' | 'external' | 'unsupported'; target: string }
  | { kind: 'local'; path: string; fragment: string }

export function resolveDocumentTarget(baseFile: string, target: string): DocumentTarget {
  if (!target || target.startsWith('#')) return { kind: 'anchor', target }
  if (/^(https?:|mailto:|tel:)/i.test(target)) return { kind: 'external', target }
  // Network-path URLs are web resources. Local UNC paths use backslashes or file://.
  if (target.startsWith('//')) return { kind: 'external', target: `https:${target}` }

  // Literal native Windows paths can contain '#' and '%' and must not be URL-decoded.
  if (isWindowsPath(target)) return { kind: 'local', path: target, fragment: '' }
  // Markdown's URI normalizer percent-encodes backslashes before rendering.
  const decodedNativePath = decodePath(target)
  if (isWindowsPath(decodedNativePath)) return { kind: 'local', path: decodedNativePath, fragment: '' }
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:/i.test(target)) {
    return { kind: 'unsupported', target }
  }

  const hash = target.indexOf('#')
  const fragment = hash < 0 ? '' : target.slice(hash)
  const pathname = (hash < 0 ? target : target.slice(0, hash)).split('?')[0]
  let decoded = decodePath(pathname)
  if (/^file:/i.test(decoded)) {
    try {
      const url = new URL(pathname)
      decoded = decodePath(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') {
        if (!isWindowsPath(baseFile)) return { kind: 'unsupported', target }
        decoded = `\\\\${url.hostname}${decoded.replaceAll('/', '\\')}`
      } else if (/^\/[a-z]:\//i.test(decoded)) decoded = decoded.slice(1).replaceAll('/', '\\')
    } catch {
      return { kind: 'unsupported', target }
    }
  }
  if (isWindowsPath(decoded)) return { kind: 'local', path: decoded, fragment }
  const base = parsePath(baseFile)
  const rooted = decoded.startsWith('/') || (base.separator === '\\' && decoded.startsWith('\\'))
  return { kind: 'local', path: joinPath(rooted ? base.root : dirname(baseFile), decoded), fragment }
}

// Keep local path conversion separate from URL fragments so names such as
// "diagram%23one.svg" remain literal filesystem names after decoding.
export function resolveImageSource(baseFile: string, source: string, toAssetUrl: (path: string) => string) {
  if (/^(https?:|data:|blob:)/i.test(source)) return source
  const resolved = resolveDocumentTarget(baseFile, source)
  if (resolved.kind === 'local') return toAssetUrl(resolved.path) + resolved.fragment
  return resolved.kind === 'external' ? resolved.target : ''
}

// ReactMarkdown's default transform rejects drive-letter paths and file URLs.
// Keep its unsafe-scheme protection while allowing explicitly supported targets.
export function markdownUrlTransform(url: string) {
  if (isWindowsPath(url) || isWindowsPath(decodePath(url)) || /^file:/i.test(url)) return url
  return /^[a-z][a-z\d+.-]*:/i.test(url) && !/^(https?:|mailto:|tel:)/i.test(url) ? '' : url
}
