export type OpenFileRequest = { id: number; path: string }

type ReceiverOptions = {
  subscribe: (notify: () => void) => Promise<() => void>
  pending: () => Promise<OpenFileRequest[]>
  open: (request: OpenFileRequest) => Promise<void>
  acknowledge: (id: number) => Promise<void>
  canOpen: () => boolean
  reportError: (error: unknown) => Promise<void>
}

// Subscribe before reading the retained native queue. A single consumer handles
// startup, overlapping events, and React StrictMode listener replacement.
export function createOpenFileReceiver(options: ReceiverOptions) {
  let generation: symbol | undefined
  let unsubscribe: (() => void) | undefined
  let running = false
  let wakeAgain = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const retryLater = () => {
    if (!generation || retry) return
    retry = setTimeout(() => {
      retry = undefined
      void wake()
    }, 1000)
  }

  async function wake() {
    wakeAgain = true
    if (running || !generation) return
    running = true
    try {
      while (generation) {
        wakeAgain = false
        const requests = await options.pending()
        if (!requests.length) break
        for (const request of requests) {
          if (!generation) return
          if (!options.canOpen()) { retryLater(); return }
          try {
            await options.open(request)
          } catch (error) {
            await options.reportError(error)
          }
          // An error dialog counts as handled; one bad file must not block the
          // remaining files. Transport failures leave the request queued.
          await options.acknowledge(request.id)
        }
      }
    } catch (error) {
      console.error('Unable to receive files from the operating system', error)
      retryLater()
    } finally {
      running = false
      if (generation && wakeAgain) void wake()
    }
  }

  return {
    start() {
      const token = Symbol()
      generation = token
      void options.subscribe(() => { if (generation === token) void wake() })
        .then((unlisten) => {
          if (generation !== token) { unlisten(); return }
          unsubscribe = unlisten
          void wake()
        })
        .catch((error) => console.error('Unable to subscribe to file-open requests', error))
    },
    stop() {
      generation = undefined
      unsubscribe?.()
      unsubscribe = undefined
      clearTimeout(retry)
      retry = undefined
    },
  }
}
