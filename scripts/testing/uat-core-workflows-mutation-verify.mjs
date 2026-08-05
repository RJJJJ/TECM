import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');
const testPath = 'admin-web/tests/unit/uat-core-workflows.test.ts';
const sourceFiles = [
  testPath,
  'supabase/migrations/202608050012_uat_core_workflows.sql',
  'admin-web/app/admin/exam-cohorts/actions.ts',
  'admin-web/app/admin/exam-cohorts/[id]/page.tsx',
  'admin-web/app/admin/guardians/actions.ts',
  'admin-web/app/admin/guardians/page.tsx',
  'admin-web/app/admin/guardians/guardian-account-actions.tsx',
  'admin-web/app/admin/dashboard/page.tsx',
  'admin-web/app/admin/page.tsx',
  'admin-web/components/admin-shell.tsx',
  'admin-web/lib/operations/actions.ts',
  'admin-web/lib/operations/errors.ts',
  'admin-web/app/admin/leave-makeup/leave-decision-form.tsx',
  'admin-web/app/login/actions.ts'
];

const cases = [
  {
    id: 'M20',
    description: 'Teacher regains the Admin operations dashboard.',
    file: 'admin-web/app/admin/dashboard/page.tsx',
    search: "if (context.role === 'teacher') redirect('/admin/sessions');",
    replacement: "if (false) redirect('/admin/sessions');",
    expected: 'teacher guard must precede dashboard queries'
  },
  {
    id: 'M21',
    description: 'A predictable guardian invitation error is thrown instead of returned in action state.',
    file: 'admin-web/app/admin/guardians/actions.ts',
    search: "return guardianFail(safeActionError(error, '發送家長邀請失敗，請稍後再試。', 'invite-guardian'), '發送家長邀請失敗，請稍後再試。', 'invite-guardian');",
    replacement: "throw safeActionError(error, '發送家長邀請失敗，請稍後再試。', 'invite-guardian');",
    expected: 'throw safeActionError'
  }
];

function copyFixture(destination) {
  for (const relative of sourceFiles) {
    const from = resolve(repoRoot, relative);
    if (!existsSync(from)) throw new Error(`missing mutation input: ${relative}`);
    const to = resolve(destination, relative);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function runTest(root) {
  return spawnSync(process.execPath, ['--experimental-strip-types', '--test', resolve(root, testPath)], {
    cwd: root,
    encoding: 'utf8',
    env: process.env
  });
}

const baseline = runTest(repoRoot);
if (baseline.status !== 0) {
  process.stderr.write('UAT mutation baseline tests must pass before mutation.\n');
  process.stderr.write(baseline.stdout + baseline.stderr);
  process.exit(1);
}

const evidence = [];
for (const mutation of cases) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-uat-${mutation.id.toLowerCase()}-`));
  try {
    copyFixture(tempRoot);
    const target = resolve(tempRoot, mutation.file);
    const original = readFileSync(target, 'utf8');
    const matches = original.split(mutation.search).length - 1;
    if (matches !== 1) throw new Error(`${mutation.id} mutation matched ${matches} times`);
    writeFileSync(target, original.replace(mutation.search, mutation.replacement));
    const result = runTest(tempRoot);
    const output = `${result.stdout}\n${result.stderr}`;
    const caught = result.status !== 0 && output.includes(mutation.expected);
    evidence.push({ id: mutation.id, description: mutation.description, caught });
    if (!caught) {
      process.stderr.write(output);
      throw new Error(`${mutation.id} was not caught by the regression suite`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

execFileSync('git', ['diff', '--check'], { cwd: repoRoot, stdio: 'inherit' });
process.stdout.write(`${JSON.stringify({ result: 'passed', cases: evidence })}\n`);
