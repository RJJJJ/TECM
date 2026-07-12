# 驗收報告

日期：2026-07-11  
基準 SHA：`e7d0334087ea1545c51135c238544d89494b4433`  
分支：`education-ops-mvp-v2`

`not run` 與 `skipped` 絕不視為 passed。

## 實作內容

- additive legacy baseline + tenant/operations/finance + invariants/RLS/RPC 三個 migration。
- 21 項要求模型、38 個 forced-RLS public tables、admin/staff/teacher 權限、跨 organization 隔離。
- immutable credit ledger、minor-unit finance、payment allocation、append-only audit。
- transaction/idempotent RPC：招生+報班+套票+charge、整班點名扣堂及狀態更正退堂、請假決定、付款、排補課、完成跟進及六類 automation。
- responsive 繁體中文 Admin Web：Dashboard、Students、Guardians、Teachers、Courses、Classes、Today’s Sessions、Attendance、Leave & Makeup、Packages & Credits、Charges & Payments、Follow-ups、Settings、Audit Log。
- 老師手機整班點名：只顯示本人今日課堂，預設出席，可在同一畫面切換請假／缺席，一次提交全班；重複提交不重複扣堂。
- tenant-scoped/timing-safe automation authentication；service role 只留在 server；所有訊息維持 human-in-the-loop。
- 六個 inactive、Asia/Macau、可匯入 n8n workflow；沒有外部訊息發送 node，沒有 Supabase service role key。
- deterministic demo seed 及可執行 SQL、Node、Playwright 驗收 harness。

## 主要改動檔案

- 根目錄：`README.md`、`.env.example`、`.gitignore`。
- 資料庫：`supabase/config.toml`、`supabase/migrations/*.sql`、`supabase/seed.sql`、`supabase/tests/*.sql`；並修正 `supabase_v1_schema.sql` 的 stray statement。
- Admin Web：`admin-web/components/*`、`admin-web/lib/operations/*`、`admin-web/lib/automation/*`、`admin-web/app/admin/*`、`admin-web/app/api/automation/*`、登入及 layout、package/test config。
- n8n：六個 `docs/n8n/workflows/education-ops-*.json`；舊範本改用 env secret、organization header，並修正無效 source enum。
- 測試：`admin-web/tests/unit/automation.test.ts`、`admin-web/tests/e2e/education-operations.spec.ts`、`admin-web/playwright.config.ts`、更新 automation smoke script。
- 文件：`docs/product-audit.md`、`architecture.md`、`data-model.md`、`local-setup.md`、`pilot-runbook.md`、本報告。

## Migration 及 seed 結果

以全新 `postgres:16-alpine` Docker database，按檔名次序執行：

1. plain-PostgreSQL auth compatibility shim
2. `202607110000_legacy_baseline.sql`
3. `202607110001_tenant_operations_finance.sql`
4. `202607110002_invariants_rls_rpcs.sql`
5. `supabase/seed.sql`
6. 五個 SQL assertion suites

結果：全部成功，0 個 SQL error；`supabase/seed.sql` 連續執行兩次亦成功。最終 catalog 包含 38 public tables，而且 38/38 均為 forced RLS；同 organization FK trigger 亦覆蓋所有主要營運關聯。五個 suites 全部通過，並實際驗證 22 個應被拒絕的安全／完整性操作。

Demo fixture 實際查詢結果：

- 學生 10
- 老師 2
- 班別 3
- 今日課堂 2
- 未清欠費 1
- 待安排補課 1
- 已完成補課 1
- 另含 1 位 admin、收款紀錄、低堂數套票及待確認招生查詢

## 測試結果

| 類別 | 命令／方式 | Passed | Failed | Skipped/Not run | 備註 |
|---|---|---:|---:|---:|---|
| Fresh DB migration + seed | Docker PostgreSQL 16 + `psql -v ON_ERROR_STOP=1` | 6 stages | 0 | 0 | 從空 DB 執行；seed 連續兩次成功 |
| DB assertion suites | `supabase/tests/001..005` | 5 suites | 0 | 0 | 22 個 expected rejection assertions |
| Schema/RLS | `001_schema_contract.sql`, `002_rls_tenant_isolation.sql` | 2 | 0 | 0 | 21/21 models、跨 org 讀寫及 cross-tenant FK 拒絕、staff 提權拒絕 |
| Attendance/leave/makeup | `003_attendance_leave_makeup.sql` | 1 | 0 | 0 | enrollment guard、扣堂/退堂/再扣冪等、資格、預約、2 個訊息草稿 |
| Finance/ledger | `004_finance_ledger.sql` | 1 | 0 | 0 | 招生 retry、付款 retry、欠費計算、append-only ledger |
| Automation/audit | `005_automation_audit.sql` | 1 | 0 | 0 | 六類 job、每 subject 去重、完成跟進 outcome、append-only audit |
| TypeScript | `npm run typecheck` | 1 | 0 | 0 | `tsc --noEmit` |
| Node unit | `npm test` | 5 | 0 | 0 | tenant auth、invalid secret、scoped secret、跨 tenant replay 拒絕、fallback |
| Production build | `npm run build` | 1 | 0 | 0 | Next.js 26 pages，無 build warning/error |
| Dependency audit | `npm audit --audit-level=high` | 1 | 0 | 0 | 0 vulnerabilities |
| Automation HTTP auth | 本機 Next production：missing org / wrong secret / cross-org replay | 3 | 0 | 0 | 實際回傳 400 / 401 / 401 |
| n8n JSON parse | PowerShell `ConvertFrom-Json` | 14 | 0 | 0 | 所有 tracked workflow JSON |
| n8n import | `n8nio/n8n:2.29.10 import:workflow` | 6 | 0 | 0 | 六個新 workflow 全部匯入成功 |
| Playwright discovery | `npm run test:e2e:list` | 2 discovered | 0 | 0 | desktop + teacher mobile；不是流程通過 |
| Playwright live E2E | `npm run test:e2e` | 0 | 0 | 2 skipped | 本機沒有可登入的 Supabase/GoTrue runtime credentials |
| Supabase CLI full stack | `npx supabase db reset` | 0 | 0 | 1 not run | 本機沒有 Supabase CLI；以空 PostgreSQL Docker 完成 migration/RLS/RPC proof |
| n8n scheduled execution | 啟用 schedule 並等待時間觸發 | 0 | 0 | 1 not run | n8n import 已通過；未啟動長期 scheduler |
| SwiftUI/Xcode | `xcodebuild ...` | 0 | 0 | 1 not run | 本機 Windows 沒有 Xcode |

## 尚未完成／環境限制

- Playwright 的八步 live flow 已建立並可 discovery，但沒有把 skipped 寫成通過。取得本機 Supabase/GoTrue runtime 後直接執行 `npm run test:e2e`。
- Supabase CLI/GoTrue-specific auth seed 行為未在本機執行；schema、RLS、transaction RPC 及 seed business data 已在空 PostgreSQL 16 實際通過。
- n8n workflow 已用真實 n8n image 匯入，但 schedule 未長時間運行。所有核心 idempotency 已在 DB suite 實測。
- SwiftUI 保留兼容，未在 Windows 編譯；MVP 完成不依賴 iOS。
- WhatsApp/WeChat 自動發送及 AI provider 刻意沒有接入；系統以確定性繁體中文模板及人工覆核正常運作。

## 直接驗證命令

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

完整資料庫 Docker 驗證次序記錄於本報告的 Migration 區段；有 Supabase CLI 的環境可執行：

```powershell
npx supabase start
npx supabase db reset
```

## 下一個最小商業驗證步驟

找一間澳門小型教育中心，以非敏感測試／影子資料進行一週 shadow pilot：老師每天以手機完成真實點名，管理員並行比較原 Excel/紙張流程，量度點名時間、欠費跟進完成率及補課未安排天數，然後以最常用的三項流程驗證首個月費方案。
