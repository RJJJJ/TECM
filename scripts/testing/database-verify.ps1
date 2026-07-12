param(
  [string]$PostgresImage = 'postgres:16-alpine'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$containerName = "tecm-db-verify-$PID"
$database = 'tecm_verify'

docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not available.' }

docker run --name $containerName `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=$database `
  -v "${repoRoot}:/workspace:ro" `
  -d $PostgresImage | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start PostgreSQL verification container.' }

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker exec $containerName pg_isready -U postgres -d $database 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready.' }

  $files = @(
    '/workspace/supabase/tests/000_bootstrap.sql',
    '/workspace/supabase/migrations/202607110000_legacy_baseline.sql',
    '/workspace/supabase/migrations/202607110001_tenant_operations_finance.sql',
    '/workspace/supabase/migrations/202607110002_invariants_rls_rpcs.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/tests/001_schema_contract.sql',
    '/workspace/supabase/tests/002_rls_tenant_isolation.sql',
    '/workspace/supabase/tests/003_attendance_leave_makeup.sql',
    '/workspace/supabase/tests/004_finance_ledger.sql',
    '/workspace/supabase/tests/005_automation_audit.sql'
  )

  foreach ($file in $files) {
    Write-Host "[RUN] $file"
    docker exec $containerName sh -c "psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -f '$file' 2>/dev/null"
    if ($LASTEXITCODE -ne 0) { throw "Database verification failed: $file" }
  }

  Write-Host '[PASS] migrations, repeatable seed, RLS and five SQL suites'
  docker exec $containerName psql -U postgres -d $database -F ',' -Atc `
    "select 'tables',count(*) from pg_tables where schemaname='public'
     union all select 'forced_rls',count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity
     union all select 'demo_students',count(*) from students where organization_id='10000000-0000-4000-8000-000000000000' and left(id::text,8)='15000000' and right(id::text,12)::bigint between 1 and 10
     union all select 'teachers',count(*) from teacher_profiles where organization_id='10000000-0000-4000-8000-000000000000'
     union all select 'classes',count(*) from exam_cohorts where organization_id='10000000-0000-4000-8000-000000000000'
     union all select 'today_sessions',count(*) from lesson_sessions where organization_id='10000000-0000-4000-8000-000000000000' and starts_at >= (((now() at time zone 'Asia/Macau')::date)::timestamp at time zone 'Asia/Macau') and starts_at < ((((now() at time zone 'Asia/Macau')::date+1))::timestamp at time zone 'Asia/Macau')
     union all select 'open_debt',count(*) from charges where organization_id='10000000-0000-4000-8000-000000000000' and status in ('open','partially_paid')
     union all select 'pending_makeup',count(*) from makeup_entitlements where organization_id='10000000-0000-4000-8000-000000000000' and status='available'
     union all select 'completed_makeup',count(*) from makeup_sessions where organization_id='10000000-0000-4000-8000-000000000000' and status='completed';"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read final verification counts.' }
} finally {
  docker rm -f $containerName 2>$null | Out-Null
}
