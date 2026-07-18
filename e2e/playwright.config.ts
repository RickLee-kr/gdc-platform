import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const API = process.env.PLAYWRIGHT_API_BASE_URL || process.env.GDC_E2E_API_BASE_URL || 'http://127.0.0.1:18000'
const UI = process.env.PLAYWRIGHT_BASE_URL || process.env.GDC_E2E_UI_BASE_URL || 'http://127.0.0.1:4173'

export default defineConfig({
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Matrix infra retries are handled in full-matrix.spec.ts (product failures never retried).
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'reports', 'playwright-html'), open: 'never' }],
    ['json', { outputFile: path.join(__dirname, 'reports', 'playwright-results.json') }],
  ],
  use: {
    baseURL: UI,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'smoke',
      testDir: path.join(__dirname, 'smoke'),
      timeout: 120_000,
    },
    {
      name: 'matrix',
      testDir: path.join(__dirname, 'matrix'),
      timeout: 180_000,
    },
    {
      name: 'cross-product',
      testDir: path.join(__dirname, 'cross-product/matrix'),
      timeout: 240_000,
    },
  ],
  metadata: {
    apiBaseUrl: API,
    routeProcessing: process.env.GDC_ROUTE_PROCESSING_ENABLED || 'false',
    shard: process.env.GDC_E2E_SHARD || '',
    suite: process.env.GDC_E2E_SUITE || '',
  },
})
