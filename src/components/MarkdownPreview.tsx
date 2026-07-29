import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { dirname, isMarkdown, resolveRelative } from '../lib/path'
import { MermaidDiagram } from './MermaidDiagram'

const safeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'id', 'title'],
    code: [...(defaultSchema.attributes?.code || []), ['className', /^language-/]],
  },
}

function frontMatter(content: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  return match ? { yaml: match[1], markdown: content.slice(match[0].length) } : { yaml: '', markdown: content }
}

export function MarkdownPreview({
  content,
  path,
  onOpenMarkdown,
}: {
  content: string
  path: string
  onOpenMarkdown: (path: string) => void
}) {
  const parsed = frontMatter(content)
  const components = {
    code({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
      const language = /language-(\w+)/.exec(className || '')?.[1]
      if (language === 'mermaid') return <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
      return <code className={className} {...props}>{children}</code>
    },
    img({ src = '', alt, ...props }: ComponentPropsWithoutRef<'img'>) {
      const resolved = /^(https?:|data:)/i.test(src) ? src : convertFileSrc(resolveRelative(path, src))
      return <img src={resolved} alt={alt || ''} loading="lazy" {...props} />
    },
    a({ href = '', children, ...props }: ComponentPropsWithoutRef<'a'>) {
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (href.startsWith('#')) return
        event.preventDefault()
        const resolved = resolveRelative(path, href)
        if (isMarkdown(resolved.split('#')[0])) onOpenMarkdown(resolved.split('#')[0])
        else void invoke('open_path', { path: resolved })
      }
      return <a href={href} onClick={handleClick} {...props}>{children}</a>
    },
  }

  return (
    <article className="markdown-body" data-document-dir={dirname(path)}>
      {parsed.yaml && (
        <details className="frontmatter">
          <summary>Front matter</summary>
          <pre><code className="language-yaml">{parsed.yaml}</code></pre>
        </details>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, safeSchema], rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {parsed.markdown}
      </ReactMarkdown>
    </article>
  )
}
