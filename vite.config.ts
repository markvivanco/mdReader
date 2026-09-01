import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const tauriConfig = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { version?: unknown }

if (typeof tauriConfig.version !== 'string') {
  throw new Error('src-tauri/tauri.conf.json must define an app version')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mdreader-app-version',
      transformIndexHtml(html) {
        return html.replaceAll('__MDREADER_VERSION__', tauriConfig.version as string)
      },
    },
  ],
})
