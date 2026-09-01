import {
  UnrecognizedMarkdownConstructError,
  addImportVisitor$,
  realmPlugin,
  type MdastImportVisitor,
} from '@mdxeditor/editor'
import type { Html, List } from 'mdast'
import { markdownListNeedsRawEditing } from '../../lib/markdownLists'

const sourceFaithfulListVisitor: MdastImportVisitor<List> = {
  priority: 100,
  testNode: (node) => node.type === 'list' && markdownListNeedsRawEditing(node),
  visitNode() {
    throw new UnrecognizedMarkdownConstructError(
      'This list uses Markdown semantics that the visual editor cannot preserve safely.',
    )
  },
}

const rawHtmlImageSafetyVisitor: MdastImportVisitor<Html> = {
  priority: 200,
  testNode: (node) => node.type === 'html' && node.value.trim().toLowerCase().startsWith('<img'),
  visitNode() {
    throw new UnrecognizedMarkdownConstructError(
      'Raw HTML images require Raw mode so their markup is never executed or rewritten.',
    )
  },
}

/** Routes lists that cannot round-trip losslessly to the existing Raw fallback. */
export const listPreservationPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, [rawHtmlImageSafetyVisitor, sourceFaithfulListVisitor])
  },
})
