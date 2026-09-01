export type MarkdownListShape = {
  children: readonly object[]
  ordered?: boolean | null
  start?: number | null
}

function isTaskListItem(item: object) {
  return 'checked' in item && typeof item.checked === 'boolean'
}

/** Returns true when MDXEditor's single-type list model would change meaning. */
export function markdownListNeedsRawEditing(list: MarkdownListShape) {
  const hasTaskItem = list.children.some(isTaskListItem)
  const hasPlainItem = list.children.some((item) => !isTaskListItem(item))
  const hasNonDefaultStart = Boolean(list.ordered && list.start != null && list.start !== 1)

  return hasNonDefaultStart || (hasTaskItem && (Boolean(list.ordered) || hasPlainItem))
}
