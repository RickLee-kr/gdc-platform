import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'wizard-v3-manual-validation.spec.ts',
  timeout: 180_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['line'], ['json', { outputFile: 'validation-output/wizard-v3-manual/results.json' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:18443',
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
