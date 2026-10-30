import { defineConfig, devices } from '@playwright/test'

/** Runs the three services and the monitor, then drives the monitor like an operator would. */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5200', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { command: 'npm run services', url: 'http://localhost:3441/health', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    {
      command: process.env.CI ? 'npm -w @relay/monitor run build && npm -w @relay/monitor run preview' : 'npm -w @relay/monitor run dev',
      url: 'http://localhost:5200',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
