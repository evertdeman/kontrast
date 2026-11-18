import { defineConfig, devices } from '@playwright/test'

const PORT = 5199

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
    baseURL: `http://localhost:${PORT}`,
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
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
})
