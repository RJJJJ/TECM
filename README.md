# TECM 教育中心營運系統

TECM 以 Supabase/PostgreSQL 作為唯一資料真源，同時提供 SwiftUI iOS App 與 Next.js Admin Web。本分支新增家長帳戶邀請、子女綁定、課程/請假/補課/財務查詢、通知中心、APNs outbox 及租戶安全後台。

## 主要能力

- organization tenant 隔離，admin/staff/teacher 與家長能力分離，所有敏感表開啟 FORCE RLS。
- Admin Web 可邀請、重寄、停用家長帳戶，管理通知範本、公告與投遞摘要。
- iOS 支援 magic link/password 登入、多角色能力、家長營運查詢、通知已讀/全部已讀、badge 與 deep link。
- APNs sender 使用 ES256 token auth、sandbox/production 端點、原子 claim、retry/backoff/dead-letter 及無效 token 停用。
- 鎖屏 payload 只包含通用簡短文案與 ID/category/deep-link metadata，不包含財務、學生或課程敏感細節。
- n8n workflow 預設 inactive，本儲存庫不啟動對外 WhatsApp/WeChat/Email/APNs 投遞。

## 本地開發

需要 Docker Desktop、Node.js 22+、npm 與 Supabase CLI。

```powershell
Copy-Item .env.example admin-web/.env.local
npx supabase start
npx supabase db reset
Set-Location admin-web
npm ci
npm run dev
```

將 `supabase status -o json` 顯示的本地 anon key 與 service-role key 填入 `admin-web/.env.local`，再開啟 [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)。本地 seed 帳戶：

- Email: `admin@tecm.local`
- Password: `LocalDemoOnly-1234`

完整說明見 [docs/local-setup.md](docs/local-setup.md)。

## 驗證

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
Set-Location ..
node scripts/testing/validate-n8n.mjs
node scripts/testing/repository-security-scan.mjs
deno check supabase/functions/send-apns/index.ts
```

Live E2E 需要已啟動且已 reset 的本地 Supabase，並設定 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`PLAYWRIGHT_ADMIN_EMAIL` 及 `PLAYWRIGHT_ADMIN_PASSWORD`：

```powershell
Set-Location admin-web
npm run test:e2e
```

macOS CI 會另外執行無簽名 iOS Simulator build 與 Swift tests。

## iOS 與 APNs 設定

1. 由 `TECM/Config/Secrets.template.xcconfig` 複製個人 `Secrets.xcconfig`，不要提交密鑰。
2. 在 Apple Developer 設定 App ID、Push Notifications capability、provisioning profile 與 APNs `.p8` key。
3. 將 APNs team/key/private-key 資料只存入 Supabase secrets，不存入前端、iOS bundle 或 Git。
4. 先使用 sender dry-run，再依 sandbox、TestFlight/production 順序驗證。

詳細 runbook 見 [APNs setup](docs/ios-parent-app/apns-setup.md) 與 [testing and release](docs/ios-parent-app/testing-and-release.md)。

## 文件

- [家長 App 架構](docs/ios-parent-app/architecture.md)
- [資料契約與 RLS](docs/ios-parent-app/data-contract.md)
- [家長 onboarding](docs/ios-parent-app/parent-onboarding.md)
- [通知矩陣](docs/ios-parent-app/notification-matrix.md)
- [APNs 設定](docs/ios-parent-app/apns-setup.md)
- [測試與發佈 gate](docs/ios-parent-app/testing-and-release.md)
- [本分支驗收報告](docs/acceptance-report.md)

## 安全界線

- 不提交 `.env`、APNs `.p8`、service-role key、憑證、provisioning profile、Xcode user state 或測試報告。
- iOS 只使用 anon key；service-role 只能存在 server/Edge Function secret store。
- 金額以 integer minor units 儲存；課堂與財務 ledger 保留不可變與審計軌跡。
- 合併與上線前必須完成 Apple 憑證、實體 iPhone 與人工驗收 gate。
