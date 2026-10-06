import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { markdownSchema } from './markdownSchema.ts'
import { markdownUrlTransform, resolveDocumentTarget, resolveImageSource } from './path.ts'

function render(markdown: string) {
  const destinations: ReturnType<typeof resolveDocumentTarget>[] = []
  const assets: string[] = []
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    urlTransform: markdownUrlTransform,
    rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownSchema]],
    components: {
      a: ({ href = '', children }) => {
        destinations.push(resolveDocumentTarget('C:\\Notes\\README.md', href))
        return createElement('a', { href }, children)
      },
      img: ({ src = '' }) => createElement('img', {
        src: resolveImageSource('C:\\Notes\\README.md', src, (path) => {
          assets.push(path)
          return `http://asset.localhost/${encodeURIComponent(path)}`
        }) || undefined,
        alt: 'fixture',
      }),
    },
  }, markdown))
  return { html, destinations, assets }
}

test('Windows links and images survive Markdown URI encoding and HTML sanitization', () => {
  const result = render(String.raw`[native](C:\Notes\file.md)

![image](C:\Notes\photo.png)

[file URL](file:///C:/Notes/my%20file.md#intro)

<img src="C:\Notes\raw.png" alt="raw">

[web](https://example.com/README.md)`)
  assert.deepEqual(result.assets, ['C:\\Notes\\photo.png', 'C:\\Notes\\raw.png'])
  assert.deepEqual(result.destinations, [
    { kind: 'local', path: 'C:\\Notes\\file.md', fragment: '' },
    { kind: 'local', path: 'C:\\Notes\\my file.md', fragment: '#intro' },
    { kind: 'external', target: 'https://example.com/README.md' },
  ])
})

test('allowing Windows references does not admit script schemes, handlers or embedded active content', () => {
  const result = render('<script>alert(1)</script><iframe src="file:///C:/secret"></iframe><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)"><a href="x:evil">scheme</a>')
  assert.doesNotMatch(result.html, /<script|<iframe|onerror|javascript:|x:evil/)
  assert.ok(result.destinations.every((destination) => destination.kind === 'anchor'))
})
