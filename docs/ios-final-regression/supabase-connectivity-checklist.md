# Supabase Connectivity Checklist

## 1. Required config

Do not commit real keys.

- Supabase URL: `<SUPABASE_URL>`
- Supabase anon/publishable key: `<SUPABASE_PUBLISHABLE_KEY>`
- Config loading path: `TECM/Config/SupabaseConfig.swift`
- Local config file path: `TECM/Config/Secrets.xcconfig`
- Template path: `TECM/Config/Secrets.template.xcconfig`
- Expected Info.plist keys:
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`

## 2. App startup

- [ ] App launches
- [ ] No invalid Supabase URL assertion
- [ ] No invalid publishable key fallback
- [ ] No crash in `SupabaseClientProvider`
- [ ] Home page loads

## 3. Data fetch checks

- [ ] FAQ loads from Supabase
- [ ] Courses load from Supabase
- [ ] Campuses load if app uses them
- [ ] News loads if app uses them
- [ ] Empty state appears gracefully if no data

## 4. Failure diagnosis

- Env/config missing: confirm `Secrets.xcconfig` exists locally and Xcode build settings include it.
- Project paused: resume the Supabase project and retry.
- RLS policy issue: verify anon key permissions for the queried tables.
- Anon key mismatch: confirm the key belongs to the same Supabase project URL.
- Network unavailable: test simulator network access and Supabase project reachability.
## VM/Xcode config notes from local regression

- Inject `SUPABASE_URL` and `SUPABASE_ANON_KEY` into Target Info custom properties so they exist at runtime.
- In `.xcconfig`, do not write `https://` directly because `//` is treated as a comment. Use `SUPABASE_URL = https:/$()/<project-ref>.supabase.co`.
- Use `SUPABASE_ANON_KEY` for the current Supabase Swift client configuration.
- Do not commit `Secrets.xcconfig` or real project refs/keys.
