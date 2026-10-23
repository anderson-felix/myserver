import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Injeta uma Content-Security-Policy restritiva apenas no build de produção.
 * Em dev o Vite precisa de scripts inline (react-refresh) e WebSocket de HMR.
 */
function productionCsp(): Plugin {
  return {
    name: 'homeserver-production-csp',
    apply: 'build',
    transformIndexHtml(html: string) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'"
      ].join('; ')
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    }
  }
}

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      // execa e get-port são ESM-only: ficam em devDependencies e são empacotados no bundle CJS.
      externalizeDeps: { exclude: ['execa', 'get-port'] },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    },
    plugins: [react(), tailwindcss(), productionCsp()]
  }
})
