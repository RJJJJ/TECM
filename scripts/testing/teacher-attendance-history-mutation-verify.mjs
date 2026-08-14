import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const testPath = 'admin-web/tests/unit/teacher-attendance-history.test.ts';
const sourceFiles = [
  testPath,
  'supabase/tests/017_teacher_attendance_history_access.sql',
  'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
  'admin-web/app/admin/attendance/page.tsx',
  'admin-web/components/teacher-attendance-form.tsx',
  'admin-web/components/admin-shell.tsx',
  'admin-web/lib/operations/actions.ts',
  'admin-web/lib/operations/errors.ts'
];
const sourceSnapshots = new Map(sourceFiles.map((relative) => [relative, readFileSync(resolve(repoRoot, relative), 'utf8')]));

const cases = [
  {
    id: 'M30',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: '  if not exists (\n    select 1 from public.teacher_profiles tp',
    replacement: '  if false and not exists (\n    select 1 from public.teacher_profiles tp',
    expected: 'teacher attendance history has server-enforced assignment'
  },
  {
    id: 'M31',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: 'for each row execute function public.capture_attendance_history_audit();',
    replacement: 'for each row execute function public.capture_audit_log();',
    expected: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe'
  },
  {
    id: 'M32',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: "if session_row.starts_at > now() then raise exception 'future session attendance is not allowed'; end if;",
    replacement: "if false then raise exception 'future session attendance is not allowed'; end if;",
    expected: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe'
  },
  {
    id: 'M33',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: 'and target_expected_updated_at is distinct from attendance_row.updated_at then',
    replacement: 'and false then',
    expected: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe'
  },
  {
    id: 'M34',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: 'create index if not exists idx_lesson_sessions_teacher_history\n  on public.lesson_sessions (teacher_id, starts_at desc);',
    replacement: '-- M34 mutation removed the teacher history index',
    expected: 'teacher attendance history index is missing'
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

function verifyIndexContract(root) {
  const migration = readFileSync(resolve(root, 'supabase/migrations/202608140014_teacher_attendance_history_access.sql'), 'utf8');
  const sqlSuite = readFileSync(resolve(root, 'supabase/tests/017_teacher_attendance_history_access.sql'), 'utf8');
  if (!migration.includes('create index if not exists idx_lesson_sessions_teacher_history')) {
    throw new Error('teacher attendance history index is missing');
  }
  if (!sqlSuite.includes('teacher attendance history index is missing')) {
    throw new Error('SQL 017 is missing the teacher attendance history index assertion');
  }
}

function runTest(root) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', resolve(root, testPath)], { cwd: root, encoding: 'utf8', env: process.env });
  if (result.status !== 0) return result;
  try {
    verifyIndexContract(root);
    return result;
  } catch (error) {
    return { status: 1, stdout: result.stdout, stderr: `${result.stderr}\n${error.message}` };
  }
}

const baseline = runTest(repoRoot);
if (baseline.status !== 0) {
  process.stderr.write('Teacher attendance mutation baseline must pass before mutation.\n');
  process.stderr.write(baseline.stdout + baseline.stderr);
  process.exit(1);
}

const evidence = [];
const cleanupEvidence = [];
for (const mutation of cases) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-teacher-attendance-${mutation.id.toLowerCase()}-`));
  try {
    copyFixture(tempRoot);
    const target = resolve(tempRoot, mutation.file);
    const original = readFileSync(target, 'utf8').replaceAll('\r\n', '\n');
    const matches = original.split(mutation.search).length - 1;
    if (matches !== 1) throw new Error(`${mutation.id} mutation matched ${matches} times`);
    writeFileSync(target, original.replace(mutation.search, mutation.replacement));
    const result = runTest(tempRoot);
    const output = `${result.stdout}\n${result.stderr}`;
    const caught = result.status !== 0 && output.includes(mutation.expected);
    evidence.push({ id: mutation.id, caught });
    if (!caught) throw new Error(`${mutation.id} was not caught by the regression suite\n${output}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleanupEvidence.push({ id: mutation.id, cleaned: !existsSync(tempRoot) });
  }
}

const restorationPassed = sourceFiles.every((relative) => readFileSync(resolve(repoRoot, relative), 'utf8') === sourceSnapshots.get(relative));
const cleanupPassed = cleanupEvidence.length === cases.length && cleanupEvidence.every(({ cleaned }) => cleaned);
if (!restorationPassed || !cleanupPassed) {
  throw new Error(`mutation restoration/cleanup failed: restoration=${restorationPassed} cleanup=${cleanupPassed}`);
}

process.stdout.write(`${JSON.stringify({
  result: 'passed',
  cases: evidence,
  restoration: restorationPassed ? 'PASS' : 'FAIL',
  cleanup: cleanupPassed ? 'PASS' : 'FAIL'
})}\n`);
