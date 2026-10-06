export type MarkdownEnvelope = {
  bom: boolean
  eol: '\n' | '\r\n'
  leadingNewlines: number
  trailingNewlines: number
}

export function markdownEnvelope(markdown: string): MarkdownEnvelope {
  const bom = markdown.startsWith('\uFEFF')
  const withoutBom = bom ? markdown.slice(1) : markdown
  const eol = withoutBom.includes('\r\n') ? '\r\n' : '\n'
  const normalized = withoutBom.replace(/\r\n/g, '\n')
  return {
    bom,
    eol,
    leadingNewlines: normalized.match(/^\n*/)?.[0].length ?? 0,
    trailingNewlines: normalized.match(/\n*$/)?.[0].length ?? 0,
  }
}

export function markdownForEditor(markdown: string) {
  return (markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown).replace(/\r\n/g, '\n')
}

export function rawEditorText(markdown: string) {
  // CodeMirror Text.toString() always joins with LF, including when a custom
  // lineSeparator is configured. Keep its controlled value in that same form.
  return markdown.replace(/\r\n/g, '\n')
}

export function rawDocumentText(markdown: string, eol: '\n' | '\r\n') {
  const normalized = rawEditorText(markdown)
  return eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
}

export function restoreMarkdownEnvelope(markdown: string, envelope: MarkdownEnvelope) {
  const core = markdown.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  if (!core) return envelope.bom ? '\uFEFF' : ''
  const normalized = `${'\n'.repeat(envelope.leadingNewlines)}${core}${'\n'.repeat(envelope.trailingNewlines)}`
  return `${envelope.bom ? '\uFEFF' : ''}${envelope.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized}`
}
