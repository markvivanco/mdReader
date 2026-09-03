export type QuitReviewInitialChoice = 'review' | 'discard-all' | 'cancel'

export type QuitReviewDocumentChoice = 'save' | 'discard' | 'cancel'

type MaybePromise<T> = T | PromiseLike<T>

type QuitReviewProgress<Document> = {
  saved: readonly Document[]
  discarded: readonly Document[]
}

export type QuitReviewResult<Document> =
  | (QuitReviewProgress<Document> & {
    shouldQuit: true
    reason: 'no-changes' | 'discarded-all' | 'reviewed'
  })
  | (QuitReviewProgress<Document> & {
    shouldQuit: false
    reason: 'cancelled'
    document?: Document
  })
  | (QuitReviewProgress<Document> & {
    shouldQuit: false
    reason: 'save-failed'
    document: Document
    error?: unknown
  })

export type QuitReviewOptions<Document> = {
  /** Dirty documents in the order in which they should be reviewed. */
  documents: readonly Document[]
  chooseInitialAction: (
    documents: readonly Document[],
  ) => MaybePromise<QuitReviewInitialChoice>
  chooseDocumentAction: (
    document: Document,
    index: number,
    total: number,
  ) => MaybePromise<QuitReviewDocumentChoice>
  /** Return false or throw when saving fails. */
  saveDocument: (document: Document) => MaybePromise<boolean | void>
}

/**
 * Coordinates quit confirmation without modifying the supplied documents or tabs.
 * All prompts and saves are awaited in document order.
 */
export async function coordinateQuitReview<Document>({
  documents,
  chooseInitialAction,
  chooseDocumentAction,
  saveDocument,
}: QuitReviewOptions<Document>): Promise<QuitReviewResult<Document>> {
  const orderedDocuments = [...documents]
  const saved: Document[] = []
  const discarded: Document[] = []

  if (orderedDocuments.length === 0) {
    return { shouldQuit: true, reason: 'no-changes', saved, discarded }
  }

  const initialAction = await chooseInitialAction(orderedDocuments)
  if (initialAction === 'cancel') {
    return { shouldQuit: false, reason: 'cancelled', saved, discarded }
  }
  if (initialAction === 'discard-all') {
    return {
      shouldQuit: true,
      reason: 'discarded-all',
      saved,
      discarded: orderedDocuments,
    }
  }

  for (const [index, document] of orderedDocuments.entries()) {
    const action = await chooseDocumentAction(document, index, orderedDocuments.length)
    if (action === 'cancel') {
      return { shouldQuit: false, reason: 'cancelled', document, saved, discarded }
    }
    if (action === 'discard') {
      discarded.push(document)
      continue
    }

    try {
      const didSave = await saveDocument(document)
      if (didSave === false) {
        return { shouldQuit: false, reason: 'save-failed', document, saved, discarded }
      }
      saved.push(document)
    } catch (error) {
      return { shouldQuit: false, reason: 'save-failed', document, error, saved, discarded }
    }
  }

  return { shouldQuit: true, reason: 'reviewed', saved, discarded }
}
