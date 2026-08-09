import { defineConfig, devices } from '@playwright/test'

/**
 * Targeted Governance Workspace checks with mocked APIs (no live backend required).
 * Uses vite preview (no FS watchers) to avoid ENOSPC on constrained hosts.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/governance-workspace-snapshot.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
