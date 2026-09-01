/* oxlint-disable react/only-export-components -- Editor nodes, plugin, and toolbar controls form one integration unit. */
import {
  DialogButton,
  NestedEditorsContext,
  NestedLexicalEditor,
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
  useMdastNodeUpdater,
  usePublisher,
  voidEmitter,
  type LexicalExportVisitor,
  type MdastImportVisitor,
  type NestedEditorsContextValue,
} from '@mdxeditor/editor'
import {
  DecoratorNode,
  type EditorConfig,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical'
import type { FootnoteDefinition, FootnoteReference } from 'mdast'
import {
  gfmFootnoteFromMarkdown,
  gfmFootnoteToMarkdown,
  type ToMarkdownOptions,
} from 'mdast-util-gfm-footnote'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { useCallback, useContext, useEffect, useState, type KeyboardEvent } from 'react'
import styles from './footnotePlugin.module.css'

export interface FootnotePluginOptions extends ToMarkdownOptions {}

export interface FootnoteButtonsProps {
  referenceLabel?: string
  definitionLabel?: string
  placeholder?: string
}

type SerializedFootnoteDefinitionNode = SerializedLexicalNode & {
  mdastNode: FootnoteDefinition
}

type SerializedFootnoteReferenceNode = SerializedLexicalNode & {
  mdastNode: FootnoteReference
}

function normalizeIdentifier(label: string) {
  return label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase()
}

function associationLabel(node: FootnoteDefinition | FootnoteReference) {
  return node.label ?? node.identifier
}

function footnoteDefinition(label: string): FootnoteDefinition {
  return {
    type: 'footnoteDefinition',
    identifier: normalizeIdentifier(label),
    label,
    children: [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
  }
}

function footnoteReference(label: string): FootnoteReference {
  return {
    type: 'footnoteReference',
    identifier: normalizeIdentifier(label),
    label,
  }
}

function FootnoteDefinitionEditor() {
  const readOnly = useCellValue(readOnly$)
  const updateMdastNode = useMdastNodeUpdater<FootnoteDefinition>()
  const context = useContext(NestedEditorsContext) as
    | NestedEditorsContextValue<FootnoteDefinition>
    | undefined

  if (!context) throw new Error('FootnoteDefinitionEditor requires a nested editor context')

  const { mdastNode } = context
  const label = associationLabel(mdastNode)
  const [draft, setDraft] = useState(label)

  useEffect(() => setDraft(label), [label])

  const commitLabel = useCallback(() => {
    const nextLabel = draft.trim()
    if (!nextLabel || nextLabel === label) {
      setDraft(label)
      return
    }
    updateMdastNode({ identifier: normalizeIdentifier(nextLabel), label: nextLabel })
  }, [draft, label, updateMdastNode])

  const handleLabelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.metaKey && ['f', 'n', 's', 'w'].includes(event.key.toLowerCase())) {
        event.currentTarget.blur()
        return
      }
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setDraft(label)
        event.currentTarget.blur()
      }
    },
    [label],
  )

  return (
    <section className={styles.definition} data-footnote-definition={mdastNode.identifier}>
      <label className={styles.definitionLabel}>
        <span aria-hidden="true">[^</span>
        <input
          aria-label="Footnote label"
          className={styles.labelInput}
          disabled={readOnly}
          onBlur={commitLabel}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleLabelKeyDown}
          size={Math.max(4, Math.min(18, draft.length || 4))}
          spellCheck={false}
          value={draft}
        />
        <span aria-hidden="true">]:</span>
      </label>
      <NestedLexicalEditor<FootnoteDefinition>
        block
        contentEditableProps={{
          'aria-label': `Footnote ${label} content`,
          className: styles.definitionContent,
        }}
        getContent={(node) => node.children}
        getUpdatedMdastNode={(node, children) => ({
          ...node,
          children: children as FootnoteDefinition['children'],
        })}
      />
    </section>
  )
}

type FootnoteReferenceEditorProps = {
  label: string
  onChange: (label: string) => void
}

function FootnoteReferenceEditor({ label, onChange }: FootnoteReferenceEditorProps) {
  const readOnly = useCellValue(readOnly$)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)

  useEffect(() => {
    if (!editing) setDraft(label)
  }, [editing, label])

  const commit = useCallback(() => {
    const nextLabel = draft.trim()
    if (nextLabel && nextLabel !== label) onChange(nextLabel)
    else setDraft(label)
    setEditing(false)
  }, [draft, label, onChange])

  if (editing && !readOnly) {
    return (
      <input
        aria-label="Footnote reference label"
        autoFocus
        className={styles.referenceInput}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.metaKey && ['f', 'n', 's', 'w'].includes(event.key.toLowerCase())) {
            commit()
            return
          }
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(label)
            setEditing(false)
          }
        }}
        size={Math.max(4, Math.min(18, draft.length || 4))}
        spellCheck={false}
        value={draft}
      />
    )
  }

  return (
    <sup>
      <button
        aria-label={readOnly ? `Footnote ${label}` : `Edit footnote reference ${label}`}
        className={styles.reference}
        disabled={readOnly}
        onClick={(event) => {
          event.stopPropagation()
          setDraft(label)
          setEditing(true)
        }}
        type="button"
      >
        {label}
      </button>
    </sup>
  )
}

export class FootnoteDefinitionNode extends DecoratorNode<React.JSX.Element> {
  __mdastNode: FootnoteDefinition
  __focusEmitter = voidEmitter()

  constructor(mdastNode: FootnoteDefinition, key?: NodeKey) {
    super(key)
    this.__mdastNode = mdastNode
  }

  static getType() {
    return 'mdreader-footnote-definition'
  }

  static clone(node: FootnoteDefinitionNode) {
    return new FootnoteDefinitionNode(structuredClone(node.__mdastNode), node.__key)
  }

  static importJSON(serializedNode: SerializedFootnoteDefinitionNode) {
    return $createFootnoteDefinitionNode(serializedNode.mdastNode)
  }

  exportJSON(): SerializedFootnoteDefinitionNode {
    return {
      mdastNode: structuredClone(this.getMdastNode()),
      type: FootnoteDefinitionNode.getType(),
      version: 1,
    }
  }

  createDOM(_config: EditorConfig) {
    const element = document.createElement('div')
    element.className = styles.definitionHost
    return element
  }

  updateDOM() {
    return false
  }

  decorate(parentEditor: LexicalEditor, config: EditorConfig) {
    const context: NestedEditorsContextValue<FootnoteDefinition> = {
      config,
      focusEmitter: this.__focusEmitter,
      lexicalNode: this,
      mdastNode: this.getMdastNode(),
      parentEditor,
    }

    return (
      <NestedEditorsContext.Provider value={context}>
        <FootnoteDefinitionEditor />
      </NestedEditorsContext.Provider>
    )
  }

  getMdastNode() {
    return this.getLatest().__mdastNode
  }

  setMdastNode(mdastNode: FootnoteDefinition) {
    this.getWritable().__mdastNode = mdastNode
  }

  getTextContent() {
    return `[^${associationLabel(this.getMdastNode())}]:`
  }

  isInline() {
    return false
  }

  select() {
    this.__focusEmitter.publish()
  }
}

export class FootnoteReferenceNode extends DecoratorNode<React.JSX.Element> {
  __mdastNode: FootnoteReference

  constructor(mdastNode: FootnoteReference, key?: NodeKey) {
    super(key)
    this.__mdastNode = mdastNode
  }

  static getType() {
    return 'mdreader-footnote-reference'
  }

  static clone(node: FootnoteReferenceNode) {
    return new FootnoteReferenceNode(structuredClone(node.__mdastNode), node.__key)
  }

  static importJSON(serializedNode: SerializedFootnoteReferenceNode) {
    return $createFootnoteReferenceNode(serializedNode.mdastNode)
  }

  exportJSON(): SerializedFootnoteReferenceNode {
    return {
      mdastNode: structuredClone(this.getMdastNode()),
      type: FootnoteReferenceNode.getType(),
      version: 1,
    }
  }

  createDOM(_config: EditorConfig) {
    const element = document.createElement('span')
    element.className = styles.referenceHost
    return element
  }

  updateDOM() {
    return false
  }

  decorate(editor: LexicalEditor) {
    return (
      <FootnoteReferenceEditor
        label={associationLabel(this.getMdastNode())}
        onChange={(label) => {
          editor.update(() => {
            const writable = this.getWritable()
            writable.__mdastNode = footnoteReference(label)
          })
        }}
      />
    )
  }

  getMdastNode() {
    return this.getLatest().__mdastNode
  }

  getTextContent() {
    return `[^${associationLabel(this.getMdastNode())}]`
  }

  isInline() {
    return true
  }
}

export function $createFootnoteDefinitionNode(mdastNode: FootnoteDefinition) {
  return new FootnoteDefinitionNode(structuredClone(mdastNode))
}

export function $createFootnoteReferenceNode(mdastNode: FootnoteReference) {
  return new FootnoteReferenceNode(structuredClone(mdastNode))
}

export function $isFootnoteDefinitionNode(
  node: LexicalNode | null | undefined,
): node is FootnoteDefinitionNode {
  return node instanceof FootnoteDefinitionNode
}

export function $isFootnoteReferenceNode(
  node: LexicalNode | null | undefined,
): node is FootnoteReferenceNode {
  return node instanceof FootnoteReferenceNode
}

const MdastFootnoteDefinitionVisitor: MdastImportVisitor<FootnoteDefinition> = {
  testNode: 'footnoteDefinition',
  visitNode({ lexicalParent, mdastNode }) {
    ;(lexicalParent as ElementNode).append($createFootnoteDefinitionNode(mdastNode))
  },
}

const MdastFootnoteReferenceVisitor: MdastImportVisitor<FootnoteReference> = {
  testNode: 'footnoteReference',
  visitNode({ lexicalParent, mdastNode }) {
    ;(lexicalParent as ElementNode).append($createFootnoteReferenceNode(mdastNode))
  },
}

const LexicalFootnoteDefinitionVisitor: LexicalExportVisitor<
  FootnoteDefinitionNode,
  FootnoteDefinition
> = {
  testLexicalNode: $isFootnoteDefinitionNode,
  visitLexicalNode({ actions, lexicalNode, mdastParent }) {
    actions.appendToParent(mdastParent, structuredClone(lexicalNode.getMdastNode()))
  },
}

const LexicalFootnoteReferenceVisitor: LexicalExportVisitor<
  FootnoteReferenceNode,
  FootnoteReference
> = {
  testLexicalNode: $isFootnoteReferenceNode,
  visitLexicalNode({ actions, lexicalNode, mdastParent }) {
    actions.appendToParent(mdastParent, structuredClone(lexicalNode.getMdastNode()))
  },
}

/** Adds GFM footnote reference/definition parsing, editing, and serialization. */
export const footnotePlugin = realmPlugin<FootnotePluginOptions>({
  init(realm, options) {
    realm.pubIn({
      [addActivePlugin$]: 'footnotes',
      [addSyntaxExtension$]: gfmFootnote(),
      [addMdastExtension$]: gfmFootnoteFromMarkdown(),
      [addToMarkdownExtension$]: gfmFootnoteToMarkdown(options),
      [addLexicalNode$]: [FootnoteDefinitionNode, FootnoteReferenceNode],
      [addImportVisitor$]: [MdastFootnoteDefinitionVisitor, MdastFootnoteReferenceVisitor],
      [addExportVisitor$]: [LexicalFootnoteDefinitionVisitor, LexicalFootnoteReferenceVisitor],
    })
  },
})

/** Optional toolbar controls for inserting a reference and its definition separately. */
export function FootnoteButtons({
  referenceLabel = 'Insert footnote reference',
  definitionLabel = 'Insert footnote definition',
  placeholder = 'Footnote label',
}: FootnoteButtonsProps = {}) {
  const insertDecoratorNode = usePublisher(insertDecoratorNode$)
  const insertFootnote = useCallback(
    (value: string, definition: boolean) => {
      const label = value.trim()
      if (!label) return
      insertDecoratorNode(() =>
        definition
          ? $createFootnoteDefinitionNode(footnoteDefinition(label))
          : $createFootnoteReferenceNode(footnoteReference(label)),
      )
    },
    [insertDecoratorNode],
  )

  return (
    <>
      <DialogButton
        buttonContent={<span className={styles.toolbarIcon}>[^]</span>}
        dialogInputPlaceholder={placeholder}
        onSubmit={(value) => insertFootnote(value, false)}
        submitButtonTitle={referenceLabel}
        tooltipTitle={referenceLabel}
      />
      <DialogButton
        buttonContent={<span className={styles.toolbarIcon}>[^]:</span>}
        dialogInputPlaceholder={placeholder}
        onSubmit={(value) => insertFootnote(value, true)}
        submitButtonTitle={definitionLabel}
        tooltipTitle={definitionLabel}
      />
    </>
  )
}
