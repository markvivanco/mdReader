import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState } from '@codemirror/state'
import { markdownEnvelope, rawDocumentText, rawEditorText } from './markdownEnvelope.ts'

test('CodeMirror edits preserve a Windows document BOM and CRLF while keeping a stable controlled value', () => {
  const original = '\uFEFF# Title\r\n\r\nOriginal\r\n'
  const eol = markdownEnvelope(original).eol
  const state = EditorState.create({ doc: rawEditorText(original) })
  const edited = state.update({ changes: { from: state.doc.length, insert: '\nNew paragraph\n\n' } }).state
  const saved = rawDocumentText(edited.doc.toString(), eol)
  assert.equal(saved, '\uFEFF# Title\r\n\r\nOriginal\r\n\r\nNew paragraph\r\n\r\n')
  assert.equal(rawEditorText(saved), edited.doc.toString())
})

test('Raw editing does not restore deleted blank lines or turn LF files into CRLF', () => {
  const state = EditorState.create({ doc: rawEditorText('\n\nText\n\n') })
  const edited = state.update({ changes: [{ from: 0, to: 2 }, { from: 6, to: 8 }] }).state
  assert.equal(rawDocumentText(edited.doc.toString(), '\n'), 'Text')
  assert.equal(rawDocumentText('a\r\nb\n', '\r\n'), 'a\r\nb\r\n')
})
