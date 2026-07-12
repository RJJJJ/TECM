# 驗收報告

日期：2026-07-12

分支：`education-ops-mvp-v2`

開始前 HEAD：`d72a05b346b40d67a96381983a77f34f66a87ab2`

本報告只把本輪實際執行成功的項目列為 `passed`。未執行、只發現測試、或受平台限制的項目分別列為 `not run`、`discovered only` 或 `skipped`，不視為通過。

## Release blockers 結果

| Blocker | 結果 | 修復／證據 |
|---|---|---|
| `submit_attendance` 缺少 `organization_id` | passed | 新增 additive migration `202607110003_release_blockers.sql`；RPC 從 session 取得 tenant、明確寫入 tenant 欄位，並以 tenant/session/student unique key upsert。 |
| SECURITY DEFINER 跨 organization 風險 | passed | staff/admin 改用 session/record 所屬 organization 授權；assigned teacher 同時要求 active profile 與 active organization membership；PUBLIC/anon definer EXECUTE 已撤銷；audit log 禁止 client 偽造。 |
| SQL 測試未經真實 RPC | passed | 新增 `006_submit_attendance_rpc.sql`，直接呼叫 RPC，覆蓋 admin、assigned/unassigned teacher、跨 tenant、anon privilege、invalid payload、duplicate student、cancelled session、batch atomicity、ledger transitions、audit actor 與 roster scope。 |
| Playwright live E2E 未通過 | passed | 本機 Supabase + GoTrue 上實際執行 desktop Chromium 與 mobile WebKit，2/2 passed，0 skipped。 |
| demo organization ID 不一致 | passed | env examples、automation unit fixture 與 seed 統一為 `10000000-0000-4000-8000-000000000000`。 |
| `.omx` runtime files 被追蹤 | passed | root `.gitignore` 加入 `.omx/`，既有 runtime files 從 Git index 移除但保留本機資料。 |
| 驗收報告高估完成度 | passed | 本報告改為依 fresh evidence 分類，未執行項目明確保留。 |

## 資料庫與安全驗證

| 驗證 | 狀態 | 實際結果 |
|---|---|---|
| Fresh PostgreSQL migration | passed | PostgreSQL 16 container 從空資料庫套用 bootstrap + migrations `000..003`。 |
| Repeatable seed | passed | `supabase/seed.sql` 連續執行兩次成功。 |
| SQL suites | passed | `001..006` 六個 suites 全部成功。 |
| Schema / forced RLS | passed | 38 public tables；38/38 forced RLS。 |
| Attendance ledger | passed | repeated present 不重扣；present→absent/excused 只回一堂；回到 present 只再扣一堂；mixed invalid batch 不部分寫入。 |
| Tenant authorization | passed | organization A staff 無法讀寫 organization B session；unassigned teacher 無法讀寫；assigned active teacher 可用。 |
| Function privileges | passed | anon 無 `submit_attendance` / roster RPC EXECUTE；SECURITY DEFINER functions 無 implicit PUBLIC execute。 |
| Audit integrity | passed | attendance audit actor 為登入 user；authenticated 無法直接 INSERT/UPDATE/DELETE `audit_logs`。 |
| Service-role automation | passed | SQL regression 與 production HTTP smoke 均證明 `request.jwt.claims.role=service_role` 可執行 scoped automation。 |

## Supabase Auth 與 Admin Web

| 驗證 | 狀態 | 實際結果 |
|---|---|---|
| `npx supabase start` | passed | local stack 啟動；config 使用目前 CLI 支援的 PostgreSQL 15 local runtime。 |
| `npx supabase db reset` | passed | migrations `000..003` + seed 完整成功。 |
| GoTrue password login | passed | `admin@tecm.local` / Local Demo Only password 取得 bearer session；seed 同時兼容 plain PostgreSQL shim 與完整 Supabase Auth schema。 |
| TypeScript | passed | `npm run typecheck`，0 errors。 |
| Node unit | passed | 5/5 passed，0 failed/skipped。 |
| Production build | passed | `npm run build`，26 static/dynamic routes 建置成功。 |
| Playwright discovery | discovered only | 2 tests：desktop Chromium、teacher mobile WebKit。 |
| Playwright live E2E | passed | 2/2 passed，0 failed，0 skipped；登入、招生/報讀、收費、點名/ledger、請假、補課、Dashboard、Follow-ups 均實際執行。 |

Live E2E 亦修正三個測試/產品可靠性問題：登入後等待最終 dashboard redirect、避免 strict locator 誤判，以及將 React `useId()` mutation key 改為每個 mounted form 的 UUID，防止跨 session idempotency collision。

## n8n / automation

| 驗證 | 狀態 | 實際結果 |
|---|---|---|
| Six education-ops workflow JSON parse | passed | 6/6 valid JSON。 |
| Workflow safety contract | passed | 6/6 inactive、`Asia/Macau`、使用 organization + secret headers、沒有 Supabase service-role key 或自動 WhatsApp/WeChat 發送 node。 |
| Production automation HTTP smoke | passed | 6/6：missing secret 401、invalid secret 401、operation retry idempotent、digest、preview、create task。 |
| n8n import | passed | `n8nio/n8n:2.29.10 import:workflow`，6/6 workflow 成功匯入。 |
| Scheduled n8n execution | not run | 本輪只驗證 import contract 與實際 HTTP endpoint；沒有啟用 schedule。 |

## 平台限制與未完成項目

- SwiftUI/Xcode：`not run`；目前環境為 Windows，沒有 Xcode。
- WhatsApp/WeChat 自動發送：`not run`，且設計上維持 human-in-the-loop，不在本輪 scope。
- Production deployment：`not run`，本輪禁止自動部署 production。
- n8n schedule：`not run`，workflow 保持 inactive。

## 重現命令

```powershell
./scripts/testing/database-verify.ps1
npx supabase start
npx supabase db reset
Set-Location admin-web
npm ci
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_ADMIN_EMAIL='admin@tecm.local'
$env:PLAYWRIGHT_ADMIN_PASSWORD='LocalDemoOnly-1234'
npm run test:e2e
```

Automation HTTP smoke（本機 demo only）：

```powershell
./scripts/testing/automation-api-smoke-test.ps1 `
  -BaseUrl http://127.0.0.1:3000 `
  -AutomationSecret <local-secret> `
  -OrganizationId 10000000-0000-4000-8000-000000000000 `
  -BookingId 38000000-0000-4000-8000-000000000001
```
