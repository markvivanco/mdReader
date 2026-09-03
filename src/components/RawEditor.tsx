import { markdown } from '@codemirror/lang-markdown'
import { setSearchQuery, SearchQuery } from '@codemirror/search'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useEffect, useRef } from 'react'

export function RawEditor({
  value,
  onChange,
  editing,
  jumpLine,
  searchQuery,
  onJumpComplete,
}: {
  value: string
  onChange: (value: string) => void
  editing: boolean
  jumpLine?: number
  searchQuery: string
  onJumpComplete: () => void
}) {
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: searchQuery, caseSensitive: false, literal: true })),
    })
  }, [searchQuery])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !jumpLine) return
    const lineNumber = Math.min(Math.max(1, jumpLine), view.state.doc.lines)
    const line = view.state.doc.line(lineNumber)
    view.dispatch({
      selection: EditorSelection.range(line.from, line.to),
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    view.focus()
    onJumpComplete()
  }, [jumpLine, onJumpComplete])

  return (
    <CodeMirror
      className={`code-editor${editing ? '' : ' read-only'}`}
      value={value}
      height="100%"
      extensions={[markdown(), EditorView.lineWrapping]}
      editable={editing}
      readOnly={!editing}
      onCreateEditor={(view) => { viewRef.current = view }}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
      }}
    />
  )
}
