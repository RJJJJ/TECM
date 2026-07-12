# TECM 教育中心營運助手 MVP

TECM 是為澳門小型補習社、興趣班及語言中心而設的營運系統。Supabase/PostgreSQL 是唯一資料真相；responsive Next.js Admin Web 可完成招生、報讀、套票、收費、手機點名、請假補課、欠費跟進及營運報表。SwiftUI App 保留兼容，但不是 MVP 啟動的必要條件。

## 功能

- organization tenant、admin/staff/teacher 權限及 RLS 隔離
- 家長、學生、課程、班別、報讀及課堂
- immutable 堂數 ledger、套票、收費單、付款及欠費
- 老師手機點名；重複提交不會重複扣堂
- 請假資格、補課安排及人工家長訊息草稿
- 低堂數、欠費、未補課及招生跟進
- 六個 inactive n8n workflow；只建立內部任務，不直接發送訊息
- 可重現 migration、demo seed、SQL assertions、Node unit tests 及 Playwright 流程

## 本地啟動

需求：Docker Desktop、Node.js 22+、npm。建議另裝 Supabase CLI；也可用 `npx supabase`。

```powershell
Copy-Item .env.example admin-web/.env.local
npx supabase start
npx supabase db reset
Set-Location admin-web
npm ci
npm run dev
```

`supabase start` 完成後，把 CLI 顯示的本機 anon key 及 service role key 填入 `admin-web/.env.local`。瀏覽 [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)，以 seed account 登入：

- `admin@tecm.local`
- `LocalDemoOnly-1234`

以上密碼只供本機 seed，部署前必須停用或更換。完整步驟及故障排除見 [docs/local-setup.md](docs/local-setup.md)。

## 驗證

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm run typecheck
npm test
npm run build
npm run test:e2e
```

資料庫 assertion 位於 `supabase/tests`；上面的 PowerShell 命令會在一次性 PostgreSQL 16 container 內從空資料庫執行 migration、重複 seed 及五個 suites。實際本次執行結果見 [docs/acceptance-report.md](docs/acceptance-report.md)。

## n8n

從 `docs/n8n/workflows/education-ops-*.json` 匯入六個 workflow，在 n8n 設定 `TECM_ADMIN_WEB_URL`、`TECM_ORGANIZATION_ID`、`TECM_AUTOMATION_SECRET`，先手動測試，再決定是否啟用 schedule。workflow 沒有 Supabase service role key，亦沒有 WhatsApp/WeChat 發送節點。

## 安全規則

- `admin-web/.env.local` 已被 git ignore；不可提交真實 key。
- 金額以整數 minor units 儲存；堂數以 append-only ledger 求和。
- n8n 只可呼叫 `/api/automation/*`；不可取得 service role key。
- 所有訊息預設只產生草稿，必須由職員人工覆核及發送。

## 文件

- [產品審計](docs/product-audit.md)
- [架構](docs/architecture.md)
- [資料模型](docs/data-model.md)
- [本地設定](docs/local-setup.md)
- [試點 runbook](docs/pilot-runbook.md)
- [驗收報告](docs/acceptance-report.md)
