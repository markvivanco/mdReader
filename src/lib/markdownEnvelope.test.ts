import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownEnvelope, markdownForEditor, restoreMarkdownEnvelope } from './markdownEnvelope.ts'

test('normalizes editor input without changing document semantics', () => {
  assert.equal(markdownForEditor('\uFEFF# Title\r\n\r\nBody\r\n'), '# Title\n\nBody\n')
})

test('restores BOM, CRLF, and surrounding newlines after a visual edit', () => {
  const original = '\uFEFF\r\n# Title\r\n\r\nBody\r\n\r\n'
  const envelope = markdownEnvelope(original)

  assert.deepEqual(envelope, {
    bom: true,
    eol: '\r\n',
    leadingNewlines: 1,
    trailingNewlines: 2,
  })
  assert.equal(
    restoreMarkdownEnvelope('# Updated\n\nBody', envelope),
    '\uFEFF\r\n# Updated\r\n\r\nBody\r\n\r\n',
  )
})

test('does not add a final newline to files that did not have one', () => {
  assert.equal(restoreMarkdownEnvelope('Changed', markdownEnvelope('Original')), 'Changed')
})

test('keeps an empty edited document empty', () => {
  assert.equal(restoreMarkdownEnvelope('', markdownEnvelope('')), '')
})
