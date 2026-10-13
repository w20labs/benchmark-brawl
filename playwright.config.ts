import { defineConfig, devices } from '@playwright/test';

// Tests run against the built page (npm run build) straight from disk.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
  projects: [
    { name: 'desktop' },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
