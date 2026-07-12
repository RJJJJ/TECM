# 本地設定及驗收

## 1. 檢查工具

```powershell
docker version
node --version
npm --version
npx supabase --version
```

## 2. 啟動 Supabase 及重建資料

```powershell
Copy-Item .env.example admin-web/.env.local
npx supabase start
npx supabase db reset
```

把 `supabase status` 顯示的 API URL、anon key、service role key 填進 `admin-web/.env.local`。不要把真實 key 寫入任何 tracked 檔案。

## 3. Admin Web

```powershell
Set-Location admin-web
npm ci
npm run typecheck
npm test
npm run dev
```

不依賴 Supabase CLI 的完整資料庫驗證：

```powershell
./scripts/testing/database-verify.ps1
```

登入 `http://127.0.0.1:3000/login`。如果 seed auth user 無法由本機 Supabase 版本建立，先在 Studio 建立 `admin@tecm.local`，再執行 seed 的 member linkage 區段；驗收報告必須把這項列為環境差異。

## 4. E2E

安裝 browser（每部開發機一次）：

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_ADMIN_EMAIL='admin@tecm.local'
$env:PLAYWRIGHT_ADMIN_PASSWORD='LocalDemoOnly-1234'
npm run test:e2e
```

## 5. n8n

匯入 `docs/n8n/workflows/education-ops-*.json`。在 n8n container/env 設定 `TECM_ADMIN_WEB_URL`、`TECM_ORGANIZATION_ID`、`TECM_AUTOMATION_SECRET`。每個 workflow 先手動執行兩次，確認第二次不增加重複 task，再按中心要求啟用。預設全部 inactive。

## 常見問題

- `401 Invalid automation credentials`：檢查兩邊 secret；不要把 secret 貼入 workflow Set node。
- 空白 dashboard：確認 migration、seed 及登入 user 的 organization membership。
- 老師看不到課堂：確認 teacher profile 的 `user_id`、membership role 及 session teacher 相同。
- E2E skipped：設定 Playwright 帳戶 env；skipped 不等於 passed。
