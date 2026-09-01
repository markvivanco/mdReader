import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownListNeedsRawEditing } from './markdownLists.ts'

test('routes mixed ordinary and task lists to source-faithful Raw editing', () => {
  assert.equal(markdownListNeedsRawEditing({
    ordered: false,
    children: [{ checked: null }, { checked: true }, { checked: false }],
  }), true)
})

test('allows uniform bullet and task lists in the rich editor', () => {
  assert.equal(markdownListNeedsRawEditing({ children: [{}, {}] }), false)
  assert.equal(markdownListNeedsRawEditing({ children: [{ checked: true }, { checked: false }] }), false)
})

test('protects ordered tasks and non-default ordered-list starts', () => {
  assert.equal(markdownListNeedsRawEditing({ ordered: true, children: [{ checked: true }] }), true)
  assert.equal(markdownListNeedsRawEditing({ ordered: true, start: 3, children: [{}] }), true)
  assert.equal(markdownListNeedsRawEditing({ ordered: true, start: 1, children: [{}] }), false)
})
