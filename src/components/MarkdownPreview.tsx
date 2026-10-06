import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { dirname, isMarkdown, markdownUrlTransform, resolveDocumentTarget, resolveImageSource } from '../lib/path'
import { markdownSchema } from '../lib/markdownSchema'
import { MermaidDiagram } from './MermaidDiagram'

function frontMatter(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  return match ? { yaml: match[1], markdown: content.slice(match[0].length) } : { yaml: '', markdown: content }
}

export function MarkdownPreview({
  content,
  path,
  onOpenMarkdown,
  forPrint = false,
}: {
  content: string
  path: string
  onOpenMarkdown: (path: string) => void
  forPrint?: boolean
}) {
  const parsed = frontMatter(content)
  const components = {
    code({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
      const language = /language-(\w+)/.exec(className || '')?.[1]
      if (language === 'mermaid') return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
      return <code className={className} {...props}>{children}</code>
    },
    img({ src = '', alt, ...props }: ComponentPropsWithoutRef<'img'>) {
      const resolved = resolveImageSource(path, src, convertFileSrc)
      return <img src={resolved} alt={alt || ''} loading={forPrint ? 'eager' : 'lazy'} {...props} />
    },
    a({ href = '', children, ...props }: ComponentPropsWithoutRef<'a'>) {
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (href.startsWith('#')) return
        event.preventDefault()
        const resolved = resolveDocumentTarget(path, href)
        if (resolved.kind === 'local' && isMarkdown(resolved.path)) onOpenMarkdown(resolved.path)
        else if (resolved.kind === 'local') void invoke('open_path', { path: resolved.path })
        else if (resolved.kind === 'external') void invoke('open_path', { path: resolved.target })
      }
      return <a href={href} onClick={handleClick} {...props}>{children}</a>
    },
  }

  return (
    <article className="markdown-body" data-document-dir={dirname(path)}>
      {parsed.yaml && (
        <details className="frontmatter" open={forPrint || undefined}>
          <summary>Front matter</summary>
          <pre><code className="language-yaml">{parsed.yaml}</code></pre>
        </details>
      )}
      <ReactMarkdown
        urlTransform={markdownUrlTransform}
        remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema], rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {parsed.markdown}
      </ReactMarkdown>
    </article>
  )
}
