import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import * as viteCommonjsNs from 'vite-plugin-commonjs'
import { defineConfig, type PluginOption } from 'vite'

// vite-plugin-commonjs ships a default export, but TS mis-resolves its shape
// under NodeNext + verbatimModuleSyntax. Normalise both module shapes (ESM
// default fn / CJS namespace) and cast to the real factory signature.
type CommonjsFactory = (opts?: {
  filter?: (id: string) => boolean
}) => PluginOption
const viteCommonjs = ((viteCommonjsNs as { default?: unknown }).default ??
  viteCommonjsNs) as unknown as CommonjsFactory

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read the version from package.json so the UI can show it. In CI the deploy
// runs after semantic-release has bumped this field, so the built site always
// reflects the version that was just released.
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Served from https://evertdeman.github.io/kontrast/ on GitHub Pages, so the
  // production bundle must reference assets under /kontrast/. Dev stays at root.
  base: command === 'build' ? '/kontrast/' : '/',
  // Compile-time constant; see src/types/globals.d.ts for the type.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Cornerstone's WASM codecs (@cornerstonejs/codec-*) are UMD/CommonJS
    // Emscripten bundles. Served raw by Vite's dev server they expose no ESM
    // `default` export and white-screen the app. This converts them to ESM.
    viteCommonjs({
      // IMPORTANT: return a strict boolean. Returning `undefined` makes the
      // plugin fall back to its own CJS detection for EVERY module, which
      // mis-transforms @cornerstonejs/core|tools and yields
      // "Class extends value undefined". Limit it to the codec bundles only.
      filter: (id: string) => /@cornerstonejs[\\/]codec-/.test(id),
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // dcmjs → xmlbuilder2 does `class … extends EventEmitter` from Node's
      // `events`, which Vite externalizes in the browser (→ "Class extends
      // undefined"). Point it at the browser polyfill instead.
      events: 'events',
    },
  },
  // Keep the loader itself unbundled so its
  // `new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url))` works;
  // pre-bundle dicom-parser (CommonJS).
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      // The metadata registry must be a singleton. Core is pre-bundled with
      // its own copy inlined, while the (excluded) loader would otherwise
      // import the raw package, creating a second registry. Then
      // `prefetchPart10Instance` writes to one and `loadImage` reads from the
      // other → "no pixel data in NATURALIZED". Pre-bundling it here makes
      // both resolve to the same shared chunk.
      '@cornerstonejs/dicom-image-loader > @cornerstonejs/metadata',
    ],
  },
  worker: {
    format: 'es',
  },
}))
