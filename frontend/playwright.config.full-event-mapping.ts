import { defineConfig, devices } from '@playwright/test'

/**
 * API-focused Playwright config for wizard full-event mapping.
 * No globalSetup auth probe — works when REQUIRE_AUTH=false (dev platform).
 */
const apiProxyTarget = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'wizard-full-event-mapping.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
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
