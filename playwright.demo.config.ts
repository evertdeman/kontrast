import { defineConfig, devices } from '@playwright/test'

// Records the README demo: `pnpm demo` writes docs/demo.webm from the production build.
const PORT = 4199
const BASE_URL = `http://localhost:${PORT}/kontrast/`
const SIZE = { width: 1280, height: 800 }

export default defineConfig({
  testDir: 'tests/demo',
  testMatch: '**/*.demo.ts',
  timeout: 120_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    viewport: SIZE,
    deviceScaleFactor: 1,
    video: { mode: 'on', size: SIZE },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
