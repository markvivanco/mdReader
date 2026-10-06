type PrintWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'print'>

// Wry's Windows print command only queues window.print(); its IPC response is
// not completion. Keep the React snapshot mounted through WebView2's afterprint.
export function printInWebview(target: PrintWindow, startTimeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      target.removeEventListener('beforeprint', beforePrint)
      target.removeEventListener('afterprint', afterPrint)
    }
    const beforePrint = () => clearTimeout(timeout)
    const afterPrint = () => {
      cleanup()
      resolve()
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('The print dialog did not open. Check that WebView2 and a printer or PDF destination are available.'))
    }, startTimeoutMs)
    target.addEventListener('beforeprint', beforePrint)
    target.addEventListener('afterprint', afterPrint)
    try {
      target.print()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
