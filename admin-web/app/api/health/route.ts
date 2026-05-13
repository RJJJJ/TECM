import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type AppEnvironment = 'staging' | 'development' | 'production' | 'unknown';

function appEnvironment(): AppEnvironment {
  const value = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'unknown';
  if (value === 'staging' || value === 'development' || value === 'production') return value;
  return 'unknown';
}

function isConfigured(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'tecm-admin-web',
    environment: appEnvironment(),
    timestamp: new Date().toISOString(),
    checks: {
      supabaseUrlConfigured: isConfigured(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseAnonConfigured: isConfigured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      serviceRoleConfigured: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY),
      automationSecretConfigured: isConfigured(process.env.TECM_AUTOMATION_SECRET)
    }
  });
}
