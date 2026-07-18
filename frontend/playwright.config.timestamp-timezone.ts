import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'timestamp-conversion-timezone-restore.spec.ts',
  timeout: 180_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://127.0.0.1:18443',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
