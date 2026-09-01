import {
  NESTED_EDITOR_UPDATED_COMMAND,
  activeEditor$,
  realmPlugin,
  rootEditor$,
} from '@mdxeditor/editor'

type EditorFlushPluginOptions = {
  registerFlush: (flush: () => Promise<void>) => void
}

/** Makes pending nested editors (footnotes and table cells) commit on app-level saves. */
export const editorFlushPlugin = realmPlugin<EditorFlushPluginOptions>({
  init(realm, options) {
    options?.registerFlush(async () => {
      const activeEditor = realm.getValue(activeEditor$)
      const rootEditor = realm.getValue(rootEditor$)
      if (!activeEditor || activeEditor === rootEditor) return

      activeEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined)
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
  },
})
