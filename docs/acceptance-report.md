# iOS 家長 App 與通知整合驗收報告

日期：2026-07-15

分支：`feature/ios-parent-app-push-sync`

起始 commit：`fc5f672a56923304db01e9cf352cd68a0629e401`

本報告只將當次實際執行且讀取過結果的項目標記為 `passed`。需要 macOS、Apple Developer 憑證、實體 iPhone 或真實產品環境的項目明確列為 `pending/blocked`。

## 自動化驗證結果

| 範圍 | 狀態 | 證據 |
|---|---|---|
| 分支與起始點 | passed | 從 `origin/main` 的 `fc5f672...` 建立目標分支，未 merge main |
| PostgreSQL migration | passed | 全新 PostgreSQL 16 執行 legacy baseline + `202607150004_parent_notifications.sql` |
| Repeatable seed | passed | `supabase/seed.sql` 連續執行兩次 |
| SQL regression | passed | `001..007` 七組 suite，包含 tenant 隔離、家長課節範圍、請假、通知、outbox 與 service-role RPC |
| FORCE RLS | passed | 驗證器檢查 46/46 public tables |
| Local Supabase reset | passed | `npx supabase db reset` 完成 migration 與 seed；Auth 密碼登入成功 |
| Admin lint/typecheck | passed | `npm run lint` 與 `npm run typecheck`，0 errors |
| Node unit tests | passed | 12/12，其中 APNs sender 7 項 |
| Admin production build | passed | Next.js build 成功，27 routes |
| Dependency audit | passed | `npm audit --audit-level=high`，0 vulnerabilities |
| Live Playwright E2E | passed | 干淨 DB reset 後 4/4：Chromium + WebKit/mobile，既有營運主流程 + 家長邀請/原子停用/範本/公告/投遞摘要/跨 tenant 拒絕 |
| Deno Edge Function | passed | `deno fmt --check` 與 `deno check supabase/functions/send-apns/index.ts` |
| n8n safety | passed | 14 workflow JSON 有效、inactive、無禁止的對外 sender 或密鑰 |
| Repository safety scan | passed | 316 個工作樹/候選檔案與所有可達歷史文字 blob（交付前掃描 627 個）；無 PEM/service-role JWT 洩露，無禁止的生成檔 |
| Git diff hygiene | passed | `git diff --check` 無 whitespace error |

## 功能驗收覆蓋

- 家長 onboarding：Admin 邀請/重寄/停用，原子帳戶連結，duplicate Auth/link 保護。
- Tenant 權限：家長不需要 `organization_members` 資格，但只能讀取已連結子女與未來課節；跨 organization 讀寫被拒絕。
- 家長 App：子女摘要、課程、請假、補課、點數、應繳/已繳/收據、通知已讀與 deep link。
- 多角色：admin/staff/teacher 能力保留；parent 與 teacher capability 可並存，登出會清理 Realtime、badge 與本機 push 狀態。
- APNs：用途專一的 outbox/attempts/receipts，原子 claim，重試、dead-letter、無效 token 停用、sandbox/production 路由。
- Payload privacy：lockscreen 只顯示通用短文案，完整敏感資料在 App 開啟後再經 RLS 讀取。
- Admin Web：通知範本、公告發佈、預估收件人、pending/sent/delivered/failed/dead-letter 摘要，不回顯 device token。

## 不可在本環境宣稱完成的 gate

| Gate | 狀態 | 原因/後續 |
|---|---|---|
| macOS `xcodebuild` + Swift tests | pending | Windows 無 Xcode；GitHub Actions `ios` job 已配置，推送後以該 run 為準 |
| iOS Simulator 人工 deep-link/foreground UX | pending | 需在 macOS 開啟 fixture `.apns` 驗證 |
| Apple entitlement/provisioning | blocked | 需要 Apple Developer Team/App ID/profile，儲存庫不含憑證 |
| APNs sandbox 真實裝置 | blocked | 需要 `.p8` secret 與 development-signed 實體 iPhone |
| TestFlight/production APNs | blocked | 需要 production token、TestFlight 與 Apple 憑證 |
| 真實 Email/WhatsApp/WeChat | not run by design | 本次只使用本地 Mailpit，n8n 保持 inactive，未聯絡真實家長 |
| 生產部署/資料遷移 | not run by design | 本次不合併 main、不發布、不改生產資料 |
| 真實教師/家長人工驗收 | pending | 依 `docs/ios-parent-app/testing-and-release.md` 執行後才可上線 |

## 重現命令

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
Set-Location ..
node scripts/testing/validate-n8n.mjs
node scripts/testing/repository-security-scan.mjs
deno fmt --check supabase/functions/send-apns
deno check supabase/functions/send-apns/index.ts
```

Live E2E 另需啟動本地 Supabase，執行 `npx supabase db reset`，設定本地 URL/keys 與 seed admin credentials，然後在 `admin-web` 執行 `npm run test:e2e`。
