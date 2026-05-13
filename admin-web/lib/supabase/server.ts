import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: Parameters<CookieStore['set']>[2] }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // In Server Components, set may fail when response headers are immutable.
          }
        }
      }
    }
  );
}
