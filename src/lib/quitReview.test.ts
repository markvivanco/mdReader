import assert from 'node:assert/strict'
import test from 'node:test'
import { coordinateQuitReview } from './quitReview.ts'

type Document = { path: string }

const documents: readonly Document[] = [
  { path: 'one.md' },
  { path: 'two.md' },
  { path: 'three.md' },
]

test('allows quitting immediately when there are no dirty documents', async () => {
  const result = await coordinateQuitReview({
    documents: [],
    chooseInitialAction: () => {
      throw new Error('initial prompt should not open')
    },
    chooseDocumentAction: () => {
      throw new Error('document prompt should not open')
    },
    saveDocument: () => {
      throw new Error('save should not run')
    },
  })

  assert.deepEqual(result, {
    shouldQuit: true,
    reason: 'no-changes',
    saved: [],
    discarded: [],
  })
})

test('discard-all allows quitting without prompting or saving individual documents', async () => {
  let initialPromptCount = 0
  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: (received) => {
      initialPromptCount += 1
      assert.deepEqual(received, documents)
      return 'discard-all'
    },
    chooseDocumentAction: () => {
      throw new Error('document prompt should not open')
    },
    saveDocument: () => {
      throw new Error('save should not run')
    },
  })

  assert.equal(initialPromptCount, 1)
  assert.deepEqual(result, {
    shouldQuit: true,
    reason: 'discarded-all',
    saved: [],
    discarded: documents,
  })
})

test('aggregate cancel keeps the app open without reviewing documents', async () => {
  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: () => 'cancel',
    chooseDocumentAction: () => {
      throw new Error('document prompt should not open')
    },
    saveDocument: () => {
      throw new Error('save should not run')
    },
  })

  assert.deepEqual(result, {
    shouldQuit: false,
    reason: 'cancelled',
    saved: [],
    discarded: [],
  })
})

test('reviews documents in order and supports mixed save and discard choices', async () => {
  const prompted: string[] = []
  const saved: string[] = []
  const choices = ['save', 'discard', 'save'] as const

  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: () => 'review',
    chooseDocumentAction: (document, index, total) => {
      assert.equal(total, documents.length)
      prompted.push(`${index}:${document.path}`)
      return choices[index]
    },
    saveDocument: (document) => {
      saved.push(document.path)
      return true
    },
  })

  assert.deepEqual(prompted, ['0:one.md', '1:two.md', '2:three.md'])
  assert.deepEqual(saved, ['one.md', 'three.md'])
  assert.deepEqual(result, {
    shouldQuit: true,
    reason: 'reviewed',
    saved: [documents[0], documents[2]],
    discarded: [documents[1]],
  })
})

test('per-document cancel aborts before later documents are prompted or saved', async () => {
  const prompted: string[] = []
  const saved: string[] = []

  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: () => 'review',
    chooseDocumentAction: (document, index) => {
      prompted.push(document.path)
      return index === 0 ? 'save' : 'cancel'
    },
    saveDocument: (document) => {
      saved.push(document.path)
      return true
    },
  })

  assert.deepEqual(prompted, ['one.md', 'two.md'])
  assert.deepEqual(saved, ['one.md'])
  assert.deepEqual(result, {
    shouldQuit: false,
    reason: 'cancelled',
    document: documents[1],
    saved: [documents[0]],
    discarded: [],
  })
})

test('a failed save aborts before later documents are prompted', async () => {
  const prompted: string[] = []
  const saved: string[] = []

  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: () => 'review',
    chooseDocumentAction: (document) => {
      prompted.push(document.path)
      return 'save'
    },
    saveDocument: (document) => {
      saved.push(document.path)
      return document !== documents[1]
    },
  })

  assert.deepEqual(prompted, ['one.md', 'two.md'])
  assert.deepEqual(saved, ['one.md', 'two.md'])
  assert.deepEqual(result, {
    shouldQuit: false,
    reason: 'save-failed',
    document: documents[1],
    saved: [documents[0]],
    discarded: [],
  })
})

test('a thrown save error is returned and stops review', async () => {
  const saveError = new Error('disk full')

  const result = await coordinateQuitReview({
    documents,
    chooseInitialAction: () => 'review',
    chooseDocumentAction: () => 'save',
    saveDocument: (document) => {
      if (document === documents[1]) throw saveError
      return true
    },
  })

  assert.equal(result.shouldQuit, false)
  assert.equal(result.reason, 'save-failed')
  if (result.reason === 'save-failed') {
    assert.equal(result.document, documents[1])
    assert.equal(result.error, saveError)
    assert.deepEqual(result.saved, [documents[0]])
  }
})

test('never overlaps prompts or saves', async () => {
  const events: string[] = []
  let activeOperations = 0
  let peakOperations = 0

  const operation = async <Result>(label: string, result: Result) => {
    activeOperations += 1
    peakOperations = Math.max(peakOperations, activeOperations)
    events.push(`${label}:start`)
    await new Promise((resolve) => setTimeout(resolve, 2))
    events.push(`${label}:end`)
    activeOperations -= 1
    return result
  }

  const result = await coordinateQuitReview({
    documents: documents.slice(0, 2),
    chooseInitialAction: () => operation('initial', 'review' as const),
    chooseDocumentAction: (document) => operation(`prompt:${document.path}`, 'save' as const),
    saveDocument: (document) => operation(`save:${document.path}`, true),
  })

  assert.equal(result.shouldQuit, true)
  assert.equal(peakOperations, 1)
  assert.deepEqual(events, [
    'initial:start',
    'initial:end',
    'prompt:one.md:start',
    'prompt:one.md:end',
    'save:one.md:start',
    'save:one.md:end',
    'prompt:two.md:start',
    'prompt:two.md:end',
    'save:two.md:start',
    'save:two.md:end',
  ])
})

test('does not mutate the caller\'s document array', async () => {
  const mutableDocuments = [...documents]

  await coordinateQuitReview({
    documents: mutableDocuments,
    chooseInitialAction: () => 'discard-all',
    chooseDocumentAction: () => 'cancel',
    saveDocument: () => false,
  })

  assert.deepEqual(mutableDocuments, documents)
})
