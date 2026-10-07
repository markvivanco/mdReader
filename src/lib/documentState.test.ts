import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOpenDocument,
  documentViewState,
  selectDocumentSurface,
} from './documentState.ts'

const stamp = { modifiedMs: 123, size: 7 }

test('ordinary document opens default to Preview in read-only mode', () => {
  const document = createOpenDocument({
    root: '/notes',
    path: '/notes/readme.md',
    name: 'readme.md',
    content: '# Hello',
    stamp,
  })

  assert.deepEqual(document, {
    root: '/notes',
    path: '/notes/readme.md',
    name: 'readme.md',
    content: '# Hello',
    savedContent: '# Hello',
    stamp,
    mode: 'preview',
    editing: false,
    jumpLine: undefined,
  })
})

test('search-result opens default to Raw in read-only mode at the requested line', () => {
  assert.deepEqual(documentViewState(12), {
    mode: 'raw',
    editing: false,
    jumpLine: 12,
  })
})

test('selects read-only Preview, rich editing, and Raw surfaces', () => {
  assert.equal(selectDocumentSurface({ mode: 'preview', editing: false }), 'preview')
  assert.equal(selectDocumentSurface({ mode: 'preview', editing: true }), 'rich-editor')
  assert.equal(selectDocumentSurface({ mode: 'raw', editing: false }), 'raw-editor')
  assert.equal(selectDocumentSurface({ mode: 'raw', editing: true }), 'raw-editor')
})
