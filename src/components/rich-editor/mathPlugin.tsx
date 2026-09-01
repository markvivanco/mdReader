/* oxlint-disable react/only-export-components -- Editor nodes, plugin, and toolbar controls form one integration unit. */
import {
  DialogButton,
  addActivePlugin$,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  insertDecoratorNode$,
  readOnly$,
  realmPlugin,
  useCellValue,
  usePublisher,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor'
import katex from 'katex'
import {
  $getNodeByKey,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical'
import { mathFromMarkdown, mathToMarkdown, type InlineMath, type Math } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import styles from './mathPlugin.module.css'

export interface MathPluginOptions {
  /**
   * Enables the common `$x$` inline form. Set this to false if documents often
   * contain currency values that should not be interpreted as math.
   */
  singleDollarTextMath?: boolean
}

export interface MathButtonsProps {
  inlineLabel?: string
  inlinePlaceholder?: string
  blockLabel?: string
  blockPlaceholder?: string
}

export type SerializedMathNode = SerializedLexicalNode & {
  formula: string
  inline: boolean
  meta: string | null
}

type MathEditorProps = {
  formula: string
  inline: boolean
  onChange: (formula: string) => void
}

function delimitFormula(formula: string, inline: boolean) {
  return inline ? `$${formula}$` : `$$\n${formula}\n$$`
}

function renderedFormula(formula: string, inline: boolean) {
  try {
    return {
      error: null,
      html: katex.renderToString(formula, {
        displayMode: !inline,
        output: 'htmlAndMathml',
        strict: 'ignore',
        throwOnError: false,
      }),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to render this formula',
      html: null,
    }
  }
}

function MathEditor({ formula, inline, onChange }: MathEditorProps) {
  const readOnly = useCellValue(readOnly$)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(formula)
  const rendered = useMemo(() => renderedFormula(formula, inline), [formula, inline])

  useEffect(() => {
    if (!editing) setDraft(formula)
  }, [editing, formula])

  useEffect(() => {
    if (readOnly) {
      setDraft(formula)
      setEditing(false)
    }
  }, [formula, readOnly])

  const beginEditing = useCallback(() => {
    if (!readOnly) {
      setDraft(formula)
      setEditing(true)
    }
  }, [formula, readOnly])

  const cancelEditing = useCallback(() => {
    setDraft(formula)
    setEditing(false)
  }, [formula])

  const commitEditing = useCallback(() => {
    if (draft !== formula) onChange(draft)
    setEditing(false)
  }, [draft, formula, onChange])

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.metaKey && ['f', 'n', 's', 'w'].includes(event.key.toLowerCase())) {
        commitEditing()
        return
      }
      event.stopPropagation()

      if (event.key === 'Escape') {
        event.preventDefault()
        cancelEditing()
      } else if (event.key === 'Enter' && (inline || event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        commitEditing()
      }
    },
    [cancelEditing, commitEditing, inline],
  )

  const handleEditorBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget as Node | null
      if (!event.currentTarget.contains(nextTarget)) commitEditing()
    },
    [commitEditing],
  )

  const Root = inline ? 'span' : 'div'

  if (editing && !readOnly) {
    return (
      <Root
        className={`${styles.editorSurface} ${inline ? '' : styles.blockEditorSurface}`}
        contentEditable={false}
        data-math-kind={inline ? 'inline' : 'block'}
        onBlur={handleEditorBlur}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {inline ? (
          <input
            aria-label="Inline math formula"
            autoFocus
            className={styles.formulaInput}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            spellCheck={false}
            value={draft}
          />
        ) : (
          <textarea
            aria-label="Block math formula"
            autoFocus
            className={`${styles.formulaInput} ${styles.formulaTextarea}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleEditorKeyDown}
            rows={Math.max(3, Math.min(10, draft.split('\n').length + 1))}
            spellCheck={false}
            value={draft}
          />
        )}
        <span className={styles.editorActions}>
          <button
            aria-label="Save formula"
            className={styles.editorButton}
            onClick={commitEditing}
            title={inline ? 'Save formula (Enter)' : 'Save formula (Command or Control + Enter)'}
            type="button"
          >
            ✓
          </button>
          <button
            aria-label="Cancel formula editing"
            className={styles.editorButton}
            onClick={cancelEditing}
            title="Cancel formula editing (Escape)"
            type="button"
          >
            ×
          </button>
        </span>
      </Root>
    )
  }

  return (
    <Root
      aria-label={readOnly ? undefined : `Edit ${inline ? 'inline' : 'block'} math: ${formula}`}
      className={`${styles.mathSurface} ${inline ? styles.inlineMath : styles.blockMath}`}
      contentEditable={false}
      data-math-kind={inline ? 'inline' : 'block'}
      onClick={(event) => {
        event.stopPropagation()
        beginEditing()
      }}
      onKeyDown={(event) => {
        if (!readOnly && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          event.stopPropagation()
          beginEditing()
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      title={readOnly ? undefined : 'Click to edit formula'}
    >
      {rendered.html ? (
        <span
          className={styles.renderedMath}
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      ) : (
        <code className={styles.fallbackMath} title={rendered.error ?? undefined}>
          {formula || 'Empty formula'}
        </code>
      )}
    </Root>
  )
}

/** A Lexical decorator node that preserves both inline and display math. */
export class MathNode extends DecoratorNode<React.JSX.Element> {
  __formula: string
  __inline: boolean
  __meta: string | null

  constructor(formula: string, inline: boolean, meta: string | null = null, key?: NodeKey) {
    super(key)
    this.__formula = formula
    this.__inline = inline
    this.__meta = meta
  }

  static getType() {
    return 'mdreader-math'
  }

  static clone(node: MathNode) {
    return new MathNode(node.__formula, node.__inline, node.__meta, node.__key)
  }

  static importJSON(serializedNode: SerializedMathNode) {
    return $createMathNode(
      typeof serializedNode.formula === 'string' ? serializedNode.formula : '',
      serializedNode.inline !== false,
      typeof serializedNode.meta === 'string' ? serializedNode.meta : null,
    )
  }

  exportJSON(): SerializedMathNode {
    return {
      formula: this.getFormula(),
      inline: this.isInline(),
      meta: this.getMeta(),
      type: MathNode.getType(),
      version: 1,
    }
  }

  exportDOM() {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.dataset.mdreaderMath = this.isInline() ? 'inline' : 'block'
    element.textContent = this.getTextContent()
    return { element }
  }

  createDOM(_config: EditorConfig) {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.className = this.isInline() ? styles.inlineHost : styles.blockHost
    return element
  }

  updateDOM(previousNode: MathNode) {
    return previousNode.__inline !== this.__inline
  }

  decorate(editor: LexicalEditor) {
    const nodeKey = this.getKey()
    return (
      <MathEditor
        formula={this.getFormula()}
        inline={this.isInline()}
        onChange={(formula) => {
          editor.update(() => {
            const node = $getNodeByKey<MathNode>(nodeKey)
            if ($isMathNode(node)) node.setFormula(formula)
          })
        }}
      />
    )
  }

  getFormula() {
    return this.getLatest().__formula
  }

  setFormula(formula: string) {
    this.getWritable().__formula = formula
  }

  getMeta() {
    return this.getLatest().__meta
  }

  setMeta(meta: string | null) {
    this.getWritable().__meta = meta
  }

  getTextContent() {
    return delimitFormula(this.getFormula(), this.isInline())
  }

  isInline() {
    return this.getLatest().__inline
  }
}

export function $createMathNode(formula: string, inline: boolean, meta: string | null = null) {
  return new MathNode(formula, inline, meta)
}

export function $isMathNode(node: LexicalNode | null | undefined): node is MathNode {
  return node instanceof MathNode
}

const MdastBlockMathVisitor: MdastImportVisitor<Math> = {
  testNode: 'math',
  visitNode({ actions, mdastNode }) {
    actions.addAndStepInto($createMathNode(mdastNode.value, false, mdastNode.meta ?? null))
  },
}

const MdastInlineMathVisitor: MdastImportVisitor<InlineMath> = {
  testNode: 'inlineMath',
  visitNode({ actions, mdastNode }) {
    actions.addAndStepInto($createMathNode(mdastNode.value, true))
  },
}

const LexicalMathVisitor: LexicalExportVisitor<MathNode, Math | InlineMath> = {
  testLexicalNode: $isMathNode,
  visitLexicalNode({ actions, lexicalNode }) {
    if (lexicalNode.isInline()) {
      actions.addAndStepInto('inlineMath', { value: lexicalNode.getFormula() }, false)
    } else {
      actions.addAndStepInto(
        'math',
        { meta: lexicalNode.getMeta(), value: lexicalNode.getFormula() },
        false,
      )
    }
  },
}

/**
 * Adds `$...$` and `$$...$$` parsing, rich KaTeX nodes, editing, and Markdown
 * serialization to MDXEditor.
 */
export const mathPlugin = realmPlugin<MathPluginOptions>({
  init(realm, options) {
    const extensionOptions = {
      singleDollarTextMath: options?.singleDollarTextMath ?? true,
    }

    realm.pubIn({
      [addActivePlugin$]: 'math',
      [addSyntaxExtension$]: math(extensionOptions),
      [addMdastExtension$]: mathFromMarkdown(),
      [addToMarkdownExtension$]: mathToMarkdown(extensionOptions),
      [addLexicalNode$]: MathNode,
      [addImportVisitor$]: [MdastBlockMathVisitor, MdastInlineMathVisitor],
      [addExportVisitor$]: LexicalMathVisitor,
    })
  },
})

/** Two optional MDXEditor toolbar controls for inserting inline and block math. */
export function MathButtons({
  inlineLabel = 'Insert inline math',
  inlinePlaceholder = 'e.g. E = mc^2',
  blockLabel = 'Insert block math',
  blockPlaceholder = 'e.g. \\int_0^1 x^2 \\, dx',
}: MathButtonsProps = {}) {
  const insertDecoratorNode = usePublisher(insertDecoratorNode$)

  const insertMath = useCallback(
    (value: string, inline: boolean) => {
      if (value.trim()) insertDecoratorNode(() => $createMathNode(value, inline))
    },
    [insertDecoratorNode],
  )

  return (
    <>
      <DialogButton
        buttonContent={<span className={styles.toolbarIcon}>𝑥</span>}
        dialogInputPlaceholder={inlinePlaceholder}
        onSubmit={(value) => insertMath(value, true)}
        submitButtonTitle={inlineLabel}
        tooltipTitle={inlineLabel}
      />
      <DialogButton
        buttonContent={<span className={styles.toolbarIcon}>∫</span>}
        dialogInputPlaceholder={blockPlaceholder}
        onSubmit={(value) => insertMath(value, false)}
        submitButtonTitle={blockLabel}
        tooltipTitle={blockLabel}
      />
    </>
  )
}
