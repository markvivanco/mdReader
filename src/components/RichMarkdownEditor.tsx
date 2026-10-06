import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeMirrorEditor,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { AlertTriangle, Code2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { markdownEnvelope, markdownForEditor, restoreMarkdownEnvelope } from '../lib/markdownEnvelope'
import { isMarkdown, resolveDocumentTarget, resolveImageSource } from '../lib/path'
import { MarkdownPreview } from './MarkdownPreview'
import { editorFlushPlugin } from './rich-editor/editorFlushPlugin'
import { FootnoteButtons, footnotePlugin } from './rich-editor/footnotePlugin'
import { listPreservationPlugin } from './rich-editor/listPreservationPlugin'
import { MathButtons, mathPlugin } from './rich-editor/mathPlugin'

function FormattingToolbar() {
  return (
    <ConditionalContents
      options={[
        {
          when: (editor) => editor?.editorType === 'codeblock',
          contents: () => (
            <>
              <UndoRedo />
              <Separator />
              <ChangeCodeMirrorLanguage />
            </>
          ),
        },
        {
          fallback: () => (
            <>
              <UndoRedo />
              <Separator />
              <BlockTypeSelect />
              <Separator />
              <BoldItalicUnderlineToggles />
              <StrikeThroughSupSubToggles />
              <CodeToggle />
              <Separator />
              <ListsToggle />
              <CreateLink />
              <Separator />
              <InsertImage />
              <InsertTable />
              <InsertCodeBlock />
              <MathButtons />
              <FootnoteButtons />
              <InsertThematicBreak />
              <InsertFrontmatter />
            </>
          ),
        },
      ]}
    />
  )
}

export type RichMarkdownEditorHandle = {
  path: string
  flush: (options?: { preserveFocus?: boolean }) => Promise<string>
}

type RichMarkdownEditorProps = {
  value: string
  path: string
  onChange: (value: string) => void
  onOpenMarkdown: (path: string) => void
  onSwitchToRaw: () => void
}

export const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, RichMarkdownEditorProps>(function RichMarkdownEditor({
  value,
  path,
  onChange,
  onOpenMarkdown,
  onSwitchToRaw,
}, ref) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const flushNestedEditorRef = useRef<() => Promise<void>>(async () => {})
  const envelopeRef = useRef(markdownEnvelope(value))
  const lastContentRef = useRef(value)
  const hasEditorChangesRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const onOpenMarkdownRef = useRef(onOpenMarkdown)
  const [processingError, setProcessingError] = useState<string | null>(null)
  onChangeRef.current = onChange
  onOpenMarkdownRef.current = onOpenMarkdown

  const commitMarkdown = useCallback((markdown: string) => {
    const content = restoreMarkdownEnvelope(markdown, envelopeRef.current)
    if (content !== lastContentRef.current) {
      lastContentRef.current = content
      onChangeRef.current(content)
    }
    return content
  }, [])

  useImperativeHandle(ref, () => ({
    path,
    async flush(options) {
      const activeElement = document.activeElement
      const focusedEditorElement = activeElement instanceof HTMLElement
        && shellRef.current?.contains(activeElement)
        ? activeElement
        : null

      try {
        await flushNestedEditorRef.current()
        if (focusedEditorElement) {
          focusedEditorElement.blur()
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
        if (!hasEditorChangesRef.current) return lastContentRef.current
        const markdown = editorRef.current?.getMarkdown()
        return markdown === undefined ? lastContentRef.current : commitMarkdown(markdown)
      } finally {
        if (options?.preserveFocus && focusedEditorElement?.isConnected) {
          focusedEditorElement.focus({ preventScroll: true })
        }
      }
    },
  }), [commitMarkdown, path])

  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    listPreservationPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin({
      showLinkTitleField: true,
      onClickLinkCallback: (url) => {
        if (url.startsWith('#')) return
        const resolved = resolveDocumentTarget(path, url)
        if (resolved.kind === 'local' && isMarkdown(resolved.path)) onOpenMarkdownRef.current(resolved.path)
        else if (resolved.kind === 'local') void invoke('open_path', { path: resolved.path })
        else if (resolved.kind === 'external') void invoke('open_path', { path: resolved.target })
      },
    }),
    imagePlugin({
      allowSetImageDimensions: true,
      imagePreviewHandler: async (source) => {
        return resolveImageSource(path, source, convertFileSrc)
      },
    }),
    tablePlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: '',
      codeBlockEditorDescriptors: [{ priority: -10, match: () => true, Editor: CodeMirrorEditor }],
    }),
    codeMirrorPlugin({
      autoLoadLanguageSupport: true,
      codeBlockLanguages: {
        '': 'Plain text',
        bash: 'Bash',
        css: 'CSS',
        html: 'HTML',
        js: 'JavaScript',
        json: 'JSON',
        jsx: 'JavaScript (React)',
        markdown: 'Markdown',
        mermaid: 'Mermaid',
        python: 'Python',
        rust: 'Rust',
        sql: 'SQL',
        ts: 'TypeScript',
        tsx: 'TypeScript (React)',
        yaml: 'YAML',
      },
    }),
    frontmatterPlugin(),
    editorFlushPlugin({
      registerFlush: (flush) => { flushNestedEditorRef.current = flush },
    }),
    mathPlugin(),
    footnotePlugin(),
    toolbarPlugin({
      toolbarClassName: 'rich-editor-toolbar',
      toolbarContents: FormattingToolbar,
    }),
    markdownShortcutPlugin(),
  ], [path])

  useEffect(() => {
    if (value === lastContentRef.current) return
    envelopeRef.current = markdownEnvelope(value)
    lastContentRef.current = value
    hasEditorChangesRef.current = false
    setProcessingError(null)
    editorRef.current?.setMarkdown(markdownForEditor(value))
  }, [value])

  if (processingError) {
    return (
      <div className="rich-editor-fallback" ref={shellRef}>
        <div className="rich-editor-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>This document needs Raw mode for safe editing.</strong>
            <span>The visual editor could not preserve one of its Markdown constructs.</span>
          </div>
          <button type="button" onClick={onSwitchToRaw}><Code2 size={15} /> Edit Raw</button>
        </div>
        <div className="preview-scroll">
          <MarkdownPreview content={value} path={path} onOpenMarkdown={onOpenMarkdown} />
        </div>
      </div>
    )
  }

  return (
    <div className="rich-editor-shell" ref={shellRef}>
      <MDXEditor
        ref={editorRef}
        className="rich-markdown-editor"
        contentEditableClassName="markdown-body rich-editor-content"
        markdown={markdownForEditor(value)}
        trim={false}
        suppressHtmlProcessing
        placeholder="Start writing…"
        plugins={plugins}
        onError={({ error }) => setProcessingError(error)}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize) return
          hasEditorChangesRef.current = true
          commitMarkdown(markdown)
        }}
      />
    </div>
  )
})
