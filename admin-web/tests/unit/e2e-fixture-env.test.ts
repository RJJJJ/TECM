import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  prepareAdminE2EEnvironment,
  requireLoopbackUrl
} from '../../../scripts/testing/prepare-admin-e2e-env.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const status = {
  API_URL: 'http://127.0.0.1:54321',
  ANON_KEY: 'synthetic-anon-key',
  SERVICE_ROLE_KEY: 'synthetic-service-role-key'
};

function withDestinations(run: (context: {
  root: string;
  environmentFile: string;
  maskFile: string;
}) => void) {
  const root = mkdtempSync(resolve(tmpdir(), 'tecm-e2e-env-'));
  const environmentFile = resolve(root, 'github-env');
  const maskFile = resolve(root, 'masks');
  writeFileSync(environmentFile, '');
  try {
    run({ root, environmentFile, maskFile });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('non-echoing E2E fixture helper writes every required later-step value', () => {
  withDestinations(({ environmentFile, maskFile }) => {
    let output = '';
    const result = prepareAdminE2EEnvironment({
      environment: {
        GITHUB_ENV: environmentFile,
        TECM_E2E_MASK_DESTINATION: maskFile,
        TECM_TEST_RUN_ID: '12345-1',
        TECM_E2E_SUPABASE_STATUS_JSON: JSON.stringify(status)
      },
      writeStatus: (label) => { output += `${label}\n`; }
    });
    const environment = readFileSync(environmentFile, 'utf8');
    const masks = readFileSync(maskFile, 'utf8');
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY', 'TECM_ORGANIZATION_ID', 'TECM_E2E_AUTH_IDS',
      'PLAYWRIGHT_ADMIN_EMAIL', 'PLAYWRIGHT_TEACHER_EMAIL',
      'PLAYWRIGHT_PARENT_EMAIL', 'PLAYWRIGHT_BASE_URL', 'PLAYWRIGHT_RUN_ID',
      'PLAYWRIGHT_RESULT_FILE', 'PLAYWRIGHT_EXPECTED_TESTS'
    ]) {
      assert.match(environment, new RegExp(`^${name}=`, 'm'));
      assert.ok(result.names.includes(name));
    }
    assert.ok(masks.length > 0);
    assert.equal(output, 'E2E_FIXTURE_ENV_READY\n');
    assert.doesNotMatch(output, /[^\s@]+@[^\s@]+|https?:\/\//i);
  });
});

test('E2E fixture helper accepts explicit IPv4, IPv6, and localhost loopback targets', () => {
  for (const value of [
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://[::1]:54321'
  ]) {
    assert.equal(requireLoopbackUrl(value, 'Supabase API URL'), value);
  }
});

test('E2E fixture helper rejects non-loopback browser and Supabase targets', () => {
  assert.throws(() => requireLoopbackUrl('https://example.invalid', 'browser URL'), /loopback/);
  withDestinations(({ environmentFile, maskFile }) => {
    assert.throws(() => prepareAdminE2EEnvironment({
      environment: {
        GITHUB_ENV: environmentFile,
        TECM_E2E_MASK_DESTINATION: maskFile,
        TECM_TEST_RUN_ID: '12345-1',
        TECM_E2E_SUPABASE_STATUS_JSON: JSON.stringify({ ...status, API_URL: 'https://example.invalid' })
      },
      writeStatus: () => {}
    }), /loopback/);
  });
});

test('E2E fixture helper fails closed when an environment destination is missing', () => {
  assert.throws(() => prepareAdminE2EEnvironment({
    environment: {
      TECM_TEST_RUN_ID: '12345-1',
      TECM_E2E_SUPABASE_STATUS_JSON: JSON.stringify(status)
    },
    writeStatus: () => {}
  }), /destination/);
});

test('release workflow requires the helper and contains no echoed fixture email or URI', () => {
  const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/release-validation.yml'), 'utf8');
  assert.match(workflow, /node scripts\/testing\/prepare-admin-e2e-env\.mjs/);
  assert.doesNotMatch(workflow, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(workflow, /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i);
});
