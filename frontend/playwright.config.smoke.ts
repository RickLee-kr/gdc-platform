import { defineConfig, devices } from '@playwright/test'

const apiProxyTarget = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'record-selection-smoke.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // 'line' surfaces test-level annotations (skip reasons, etc.) more clearly
  // than 'list' for a single-spec smoke. Pair with console.log fallback in the
  // spec so reasons are visible regardless of reporter.
  reporter: [['line']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_DEV_API_PROXY_TARGET: apiProxyTarget,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
