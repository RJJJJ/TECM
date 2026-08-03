import { defineConfig, devices } from '@playwright/test';
import { assertCredentialedE2EEnvironment, credentialedE2EEnvironment, requiredPlaywrightBaseUrl } from './tests/e2e/required-env';

const e2eEnvironment = credentialedE2EEnvironment();
assertCredentialedE2EEnvironment(e2eEnvironment);
const baseURL = requiredPlaywrightBaseUrl(e2eEnvironment);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['./scripts/playwright-result-reporter.mjs', {
      outputFile: process.env.PLAYWRIGHT_RESULT_FILE ?? 'test-results/playwright-results.json'
    }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'teacher-mobile', use: { ...devices['iPhone 13'] } }
  ],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1'
    ? undefined
    : {
        command: 'npm run dev',
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 120_000
      }
});
