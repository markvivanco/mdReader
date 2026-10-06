import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname, displayName, isMarkdown, isPathWithin, joinPath, markdownUrlTransform, rebasePath, resolveDocumentTarget, resolveImageSource, samePath } from './path.ts'
import { makeTree } from './fileTree.ts'

const roots = ['/', 'C:\\', '\\\\?\\C:\\', '\\\\server\\share\\', '\\\\?\\UNC\\server\\share\\']

for (const root of roots) {
  test(`tree, paths and file operations preserve native root ${root}`, () => {
    const folder = joinPath(root, 'Notes & café')
    const nested = joinPath(folder, 'nested')
    const document = joinPath(nested, 'README.MD')
    assert.equal(dirname(root), root)
    assert.equal(dirname(folder), root)
    assert.equal(dirname(document), nested)
    assert.equal(displayName(document), 'README.MD')
    assert.equal(isMarkdown(document), true)
    assert.equal(joinPath(nested, '../../../..'), root)
    assert.equal(isPathWithin(document, folder), true)
    assert.equal(isPathWithin(joinPath(root, 'Notes & café-backup/file.md'), folder), false)
    const moved = joinPath(root, 'renamed')
    assert.equal(rebasePath(document, folder, moved), joinPath(moved, 'nested/README.MD'))
    assert.equal(rebasePath(folder, folder, moved), moved)
    assert.equal(rebasePath(`${folder}-backup`, folder, moved), `${folder}-backup`)

    const entry = (path: string, isDir: boolean) => ({ path, isDir, name: displayName(path), relativePath: path.slice(root.length) })
    const tree = makeTree([entry(document, false), entry(nested, true), entry(folder, true), entry(joinPath(root, 'z.md'), false)])
    assert.equal(tree.length, 2)
    assert.equal(tree[0].path, folder)
    assert.equal(tree[0].children[0].path, nested)
    assert.equal(tree[0].children[0].children[0].path, document)
    assert.equal(tree[1].name, 'z.md')
  })
}

test('POSIX backslashes and case-sensitive directories retain distinct identities', () => {
  assert.equal(dirname('/notes/a\\b/file.md'), '/notes/a\\b')
  assert.equal(displayName('/notes/a\\b.md'), 'a\\b.md')
  assert.equal(rebasePath('/notes/A/readme.md', '/notes/a', '/notes/renamed'), '/notes/A/readme.md')
  assert.equal(isPathWithin('C:\\Notes\\a.md', 'C:\\notes'), false)
  assert.equal(isPathWithin('D:\\notes\\a.md', 'C:\\notes'), false)
})

test('Windows separators, drive roots and UNC share roots are handled explicitly', () => {
  assert.equal(dirname('C:/Users/me/notes/readme.md'), 'C:\\Users\\me\\notes')
  assert.equal(dirname('\\\\server\\share'), '\\\\server\\share\\')
  assert.equal(samePath(dirname('\\\\server\\share\\notes'), '\\\\server\\share'), true)
  assert.equal(samePath('C:\\notes', 'C:\\Notes'), false)
  assert.equal(dirname('\\\\?\\UNC\\server\\share'), '\\\\?\\UNC\\server\\share\\')
  assert.equal(joinPath('C:\\notes', 'sub\\nested/file.md'), 'C:\\notes\\sub\\nested\\file.md')
})

test('relative links/images use the native directory and decode URL paths once', () => {
  for (const root of roots) {
    const base = joinPath(root, 'notes/nested/readme.md')
    const expected = joinPath(root, 'notes/guide #1%.md')
    assert.deepEqual(resolveDocumentTarget(base, '../guide%20%231%25.md?view=1#intro'), { kind: 'local', path: expected, fragment: '#intro' })
    assert.deepEqual(resolveDocumentTarget(base, '/root.md'), { kind: 'local', path: joinPath(root, 'root.md'), fragment: '' })
    assert.deepEqual(resolveDocumentTarget(base, '../bad%2-image.png'), { kind: 'local', path: joinPath(root, 'notes/bad%2-image.png'), fragment: '' })
    assert.deepEqual(resolveDocumentTarget(base, '../literal%2523.md'), { kind: 'local', path: joinPath(root, 'notes/literal%23.md'), fragment: '' })
    const asset = resolveImageSource(base, '../diagram%23one.svg#symbol', (path) => `asset:${encodeURIComponent(path)}`)
    assert.equal(asset, `asset:${encodeURIComponent(joinPath(root, 'notes/diagram#one.svg'))}#symbol`)
  }
})

test('file URLs and native paths retain Windows drive/network identities', () => {
  const base = '\\\\?\\C:\\notes\\readme.md'
  assert.deepEqual(resolveDocumentTarget(base, 'file:///C:/notes/my%20file.md#intro'), { kind: 'local', path: 'C:\\notes\\my file.md', fragment: '#intro' })
  assert.deepEqual(resolveDocumentTarget(base, 'file://server/share/notes/a%23b.md'), { kind: 'local', path: '\\\\server\\share\\notes\\a#b.md', fragment: '' })
  assert.deepEqual(resolveDocumentTarget('/notes/readme.md', 'file:///notes/hello%20world.md'), { kind: 'local', path: '/notes/hello world.md', fragment: '' })
  for (const native of ['C:\\notes\\a#b%.md', '\\\\?\\C:\\notes\\a#b%.md', '\\\\?\\UNC\\server\\share\\a.md']) {
    assert.deepEqual(resolveDocumentTarget(base, native), { kind: 'local', path: native, fragment: '' })
  }
})

test('external .md URLs stay external and unsafe schemes are not opened', () => {
  const base = 'C:\\notes\\readme.md'
  for (const url of ['https://example.com/readme.md#intro', 'mailto:reader@example.com', 'tel:123']) {
    assert.deepEqual(resolveDocumentTarget(base, url), { kind: 'external', target: url })
    assert.equal(markdownUrlTransform(url), url)
  }
  assert.deepEqual(resolveDocumentTarget(base, '//example.com/readme.md'), { kind: 'external', target: 'https://example.com/readme.md' })
  assert.deepEqual(resolveDocumentTarget(base, '#heading'), { kind: 'anchor', target: '#heading' })
  for (const url of ['javascript:alert(1)', 'vbscript:evil', 'data:text/html,evil', 'C:relative.md']) {
    assert.equal(resolveDocumentTarget(base, url).kind, 'unsupported')
    assert.equal(markdownUrlTransform(url), '')
  }
  assert.equal(markdownUrlTransform('C:/notes/file.md'), 'C:/notes/file.md')
  assert.equal(markdownUrlTransform('file:///C:/notes/file.md'), 'file:///C:/notes/file.md')
})
