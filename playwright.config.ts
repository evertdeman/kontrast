import { defineConfig, devices } from '@playwright/test'

// The production build, as deployed, including its Content-Security-Policy.
const PORT = 4199
const BASE_URL = `http://localhost:${PORT}/kontrast/`

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        // Cornerstone renders with WebGL; CI machines have no GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // Firefox has no save dialog (File System Access API), so it checks the plain download.
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1600, height: 1000 } },
      testMatch: '**/downloads.e2e.ts',
    },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
