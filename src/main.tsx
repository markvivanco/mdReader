import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const READABLE_TIME_MS = 2_200
const EXIT_TIME_MS = 420
const REDUCED_MOTION_EXIT_TIME_MS = 80
const APP_READY_TIMEOUT_MS = 8_000

const rootElement = document.getElementById('root')!
const splashElement = document.getElementById('startup-splash')
const versionElement = document.getElementById('startup-version')
const statusElement = document.getElementById('startup-status')
const startedAt = performance.now()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const blockAppShortcuts = (event: KeyboardEvent) => {
  const isAppShortcut = event.metaKey && ['f', 'n', 's'].includes(event.key.toLowerCase())
  if (!isAppShortcut) return
  event.preventDefault()
  event.stopImmediatePropagation()
}
window.addEventListener('keydown', blockAppShortcuts, true)

const buildTimeVersion = splashElement?.dataset.version
if (statusElement && buildTimeVersion) {
  requestAnimationFrame(() => {
    statusElement.textContent = `mdReader version ${buildTimeVersion} is starting`
  })
}

if (isTauri() && splashElement && versionElement) {
  void getVersion()
    .then((version) => {
      versionElement.textContent = `Version ${version}`
      if (statusElement && version !== buildTimeVersion) {
        statusElement.textContent = `mdReader version ${version} is starting`
      }
    })
    .catch(() => {
      // The build-time value already comes from the same Tauri configuration.
    })
}

const minimumReadableTime = new Promise<void>((resolve) => {
  const remainingTime = Math.max(0, READABLE_TIME_MS - (performance.now() - startedAt))
  window.setTimeout(resolve, remainingTime)
})

const appPainted = import('./App.tsx').then(({ default: App }) => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
})

const appReadyOrTimedOut = new Promise<void>((resolve) => {
  const timeout = window.setTimeout(resolve, APP_READY_TIMEOUT_MS)
  void appPainted
    .catch((error: unknown) => console.error('Unable to start mdReader', error))
    .then(() => {
      window.clearTimeout(timeout)
      resolve()
    })
})

const unlockApp = () => {
  rootElement.inert = false
  rootElement.removeAttribute('aria-hidden')
  window.removeEventListener('keydown', blockAppShortcuts, true)
}

void Promise.all([minimumReadableTime, appReadyOrTimedOut]).then(() => {
  if (!splashElement) {
    unlockApp()
    return
  }
  const exitTime = reducedMotion ? REDUCED_MOTION_EXIT_TIME_MS : EXIT_TIME_MS
  splashElement.classList.add('startup-splash--leaving')
  window.setTimeout(() => {
    splashElement.remove()
    unlockApp()
  }, exitTime)
})
