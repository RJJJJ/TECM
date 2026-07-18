# iOS 家長 App 與通知整合驗收報告

日期：2026-07-16

分支：`feature/ios-parent-app-push-sync`

起始 commit：`fc5f672a56923304db01e9cf352cd68a0629e401`

本報告只將當次實際執行且讀取過結果的項目標記為 `passed`。需要 macOS、Apple Developer 憑證、實體 iPhone 或真實產品環境的項目明確列為 `pending/blocked`。

## 自動化驗證結果

| 範圍 | 狀態 | 證據 |
|---|---|---|
| 分支與起始點 | passed | 從 `origin/main` 的 `fc5f672...` 建立目標分支，未 merge main |
| PostgreSQL migration | passed | 全新 PostgreSQL 16 執行 legacy baseline + `202607150004_parent_notifications.sql` |
| Repeatable seed | passed | `supabase/seed.sql` 連續執行兩次 |
| SQL regression | passed | `001..007` 七組 suite，包含 legacy linked-parent migration backfill、tenant 隔離、家長課節範圍、禁止直接繞過請假 RPC、通知、outbox 與 service-role RPC |
| FORCE RLS | passed | 驗證器檢查 46/46 public tables |
| Local Supabase reset | passed | `npx supabase db reset` 完成 migration 與 seed；Auth 密碼登入成功 |
| Admin lint/typecheck | passed | `npm run lint` 與 `npm run typecheck`，0 errors |
| Node unit tests | passed | 12/12，其中 APNs sender 7 項 |
| Admin production build | passed | Next.js build 成功，27 routes |
| Dependency audit | passed | `npm audit --audit-level=high`，0 vulnerabilities |
| Live Playwright E2E | passed | 干淨 DB reset 後 4/4：Chromium + WebKit/mobile，既有營運主流程 + 家長邀請/原子停用/範本/公告/投遞摘要/跨 tenant 拒絕 |
| iOS Xcode build + Swift tests | passed | GitHub Actions [run 29408055591](https://github.com/RJJJJ/TECM/actions/runs/29408055591)：Xcode 16.4、iOS 18.5 Simulator，套件解析、無簽名 build 與 XCTest 全部成功；RC review 新增的 deep-link/logout regression tests 納入本次 PR workflow |
| Deno Edge Function | passed | `deno fmt --check` 與 `deno check supabase/functions/send-apns/index.ts` |
| n8n safety | passed | 14 workflow JSON 有效、inactive、無禁止的對外 sender 或密鑰 |
| Repository safety scan | passed | 交付前掃描至少 318 個工作樹/候選檔案與 648 個可達歷史文字 blob；無 PEM/service-role JWT 洩露，無禁止的生成檔 |
| Git diff hygiene | passed | `git diff --check` 無 whitespace error |

## 功能驗收覆蓋

- 家長 onboarding：Admin 邀請/重寄/停用，原子帳戶連結，duplicate Auth/link 保護。
- Tenant 權限：家長不需要 `organization_members` 資格，但只能讀取已連結子女與未來課節；跨 organization 讀寫被拒絕。
- 家長 App：子女摘要、課程、請假、補課、點數、應繳/已繳/收據、通知已讀與 deep link。
- 多角色：admin/staff/teacher 能力保留；parent 與 teacher capability 可並存，登出會清理 Realtime、badge 與本機 push 狀態。
- APNs：用途專一的 outbox/attempts/receipts，原子 claim，重試、dead-letter、無效 token 停用、sandbox/production 路由。
- Payload privacy：lockscreen 只顯示通用短文案，完整敏感資料在 App 開啟後再經 RLS 讀取。
- Admin Web：通知範本、公告發佈、預估收件人、pending/sent/delivered/failed/dead-letter 摘要，不回顯 device token。

## RC review 修正

- 修正未登入時收到的通知 deep link 被提早消耗：route 現在會保留到成功解析 parent capability 後才導航並清除。
- 新增 regression test，鎖定未登入／未有 user ID 時不可開始 parent navigation，完成登入後才可繼續。
- migration 會把既有已連結（`user_id` 非空）的 legacy 家長帳戶回填為 `active`，避免升級後失去存取權，並以 pre-migration fixture 驗證。
- 移除家長對 `leave_requests` 的直接 INSERT policy；家長必須經 tenant/cohort/future-session/idempotency 驗證 RPC，SQL regression 驗證 direct bypass 被拒絕。
- 登出改為 fail closed：server device deactivation 失敗時不銷毀 session；成功後 unregister remote notifications 並清除本機通知，新增 cleanup failure regression test。
- 家長帳戶接受狀態由 authenticated session activation RPC 完成，不再依賴 APNs 註冊；拒絕通知權限仍會正確標記 invitation accepted。
- 家長邀請在發送 Email 前 preflight 已知 Auth/profile/tenant 衝突；DB link failure 另寫 failed audit，並記錄外部 Auth Email 與 PostgreSQL 之間不可原子的 residual race。

## 不可在本環境宣稱完成的 gate

| Gate | 狀態 | 原因/後續 |
|---|---|---|
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
# Foundation Security Gate update (2026-07-18)

The stacked fix branch adds migration `202607180005_foundation_security.sql` and
tests for blockers A-G: legacy same-tenant identity backfill, database-time invitation
expiry, locked invitation identity, server-controlled lifecycle DML, safe timezone
normalization, strict leave idempotency, and shared register/disable lock ordering.

Local evidence: PostgreSQL 15 fresh bootstrap passed; seed and migration each passed
twice; an unsafe-data migration was blocked before its first DDL; SQL suites 001-008
passed; independent-session invitation and both device race orderings passed; Admin
unit tests passed 15/15 including lookup beyond 1,000 Auth users; Playwright passed
4/4 after a clean local Supabase reset.
See `docs/ios-parent-app/foundation-security-migration.md` for preflight and recovery.

This gate does **not** pass APNs worker/outbox reliability, Apple credentials, live
push delivery, TestFlight, production deployment, or merging to `main`.

## Foundation security regression follow-up (2026-07-18)

- `008_foundation_security.sql` now injects a controlled legacy invalid timezone
  only while the validation trigger is disabled, then restores it before invoking
  `publish_notification_announcement`. The test follows the production fanout path
  through notification creation and `enqueue_notification_devices`, and verifies
  announcement persistence plus notification/outbox rows for both a valid and the
  corrupt legacy recipient, with no cross-tenant notification.
- Mutation evidence: replacing enqueue-time normalization with direct `AT TIME ZONE
  np.timezone` fails the SQL suite with `legacy invalid timezone rolled back
  announcement fanout`.
- `database-verify.ps1` now bounds all three independent-session races with a
  configurable, non-zero deadline (60 seconds by default). Its test-only injected
  hang mode failed non-zero with timeout diagnostics and no remaining PowerShell
  background jobs. A normal verifier run passed all three races.

## APNs outbox reliability stacked gate (2026-07-18)

Branch: `fix/pr46-apns-outbox-reliability`

Stack base: `feature/ios-parent-app-push-sync` at
`4abf2c65e511ebada1d0620d057baed9b581306f`.

This gate is a forward-only reliability change. It does not merge PR #46, deploy
the Edge Function, contact Apple, alter production data, or use real credentials.

### Local evidence

| Gate | Status | Current-branch evidence |
|---|---|---|
| PostgreSQL 15 migration/state machine | PASSED | `./scripts/testing/database-verify.ps1`, exit 0: migration 006 applied twice, SQL suites 001-009, unsafe-data negative preflight, existing parent races, and bounded two-worker `FOR UPDATE SKIP LOCKED` outbox race |
| APNs SQL reliability coverage | PASSED | Suite 009 covers attempt 8, lease recovery/crash, inactive/expired/stale-generation cleanup, invalidation/reactivation, replay success/idempotency/rejections, tenant boundaries, grants, FORCE RLS, and fixed search paths |
| Admin install/audit | PASSED | `npm ci` and `npm audit --audit-level=high`; 0 vulnerabilities |
| Admin lint/typecheck | PASSED | `npm run lint` and `npm run typecheck`; 0 errors |
| Node unit tests | PASSED | `npm test`; 31/31, including 23 APNs sender/orchestrator tests |
| Admin production build | PASSED | `npm run build`; Next.js production build and 27 static pages completed |
| Deno worker checks | PASSED | `npx -y deno fmt --check supabase/functions/send-apns` checked 4 files; `npx -y deno check supabase/functions/send-apns/index.ts` exit 0 |
| n8n safety | PASSED | 14 workflow JSON files parse, remain inactive, and contain no prohibited sender/secrets |
| Repository/history safety | PASSED | 347 tracked/candidate paths and 687 reachable historical text blobs scanned; no prohibited secret/runtime artifact |
| Diff hygiene | PASSED | `git diff --check`, exit 0; only Git line-ending conversion warnings |
| Local Playwright E2E | NOT PASSED | Not rerun in this Windows pass; the required clean-Supabase Playwright gate is delegated to final-SHA CI |
| Local iOS/XCTest | NOT PASSED | `xcodebuild` is unavailable on Windows; the required macOS job is delegated to final-SHA CI |
| Apple sandbox/TestFlight/production push | NOT PASSED | No Apple credential, provisioning, physical iPhone, TestFlight, production scheduler, or live APNs request was used |
| Production deploy/data migration | NOT PASSED by design | No deployment, production mutation, main merge, or PR #46 mutation is authorized |
| Final-SHA CI | PENDING | Record only after the draft stacked PR exists and all five required jobs complete on the exact head SHA |

### Mutation verification

Every mutation was applied with a patch, run against the named test, then
reversed. The migration, core sender, and orchestrator hashes matched their
pre-mutation values after restoration.

| ID | Injected defect | Result | Catch evidence |
|---|---|---|---|
| M1 | Let a retryable attempt at count 8 remain retryable | CAUGHT | SQL suite 009 failed at the attempt ceiling (`claimable APNs outbox exceeded attempt ceiling`) |
| M2 | Remove inactive-device cleanup and claim eligibility checks | CAUGHT | Added depth-defense fixture failed case 13b: inactive legacy backlog survived claim cleanup |
| M3 | Ignore notification expiry in cleanup and candidate selection | CAUGHT | SQL suite 009 failed case 11: expired notification was not terminalized |
| M4 | Remove registration-generation cleanup and claim eligibility checks | CAUGHT | Added depth-defense fixture failed case 21b: stale-generation backlog survived claim cleanup |
| M5 | Classify APNs provider credential failures as device failures | CAUGHT | Sender tests failed provider classification and no-invalidation assertions |
| M6 | Create the APNs provider token only after claiming a row | CAUGHT | Worker tests failed preflight ordering and zero-claim-on-preflight-failure assertions |
| M7 | Replace the stable database `apns_request_id` header with a random UUID | CAUGHT | Mock-provider test rejected the changed `apns-id` request header |
| M8 | Convert accepted-but-uncommitted completion into a send-retry transition | CAUGHT | Completion-exhaustion test rejected the missing stop and unexpected retry behavior |

M2 and M4 initially showed that normal triggers cleaned the fixture before the
claim function's defensive branch was exercised. Dedicated legacy/corrupt-row
fixtures were added, and both mutations were rerun until caught.

### Independent adversarial review

- Code/state-machine review: APPROVE; 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW.
- Security/operations review: 0 CRITICAL and 0 HIGH; three MEDIUM design risks
  recorded below. No HIGH/CRITICAL remediation gate remains.
- Dry-run terminalizes claimed rows as `would_send`. The runbook now labels it
  mutating, restricts it to synthetic/disposable rows, and states that local
  signing does not prove Apple accepts repaired credentials.
- The active-token uniqueness policy can deactivate the same unguessable APNs
  token across tenants during authenticated token transfer. This inherited
  global-token behavior prioritizes preventing delivery to a previous account;
  token knowledge remains a denial-of-service precondition. No broader token
  read access was introduced.
- One backend intentionally routes each row by its stored `sandbox` or
  `production` environment. Bundle ID is pinned by worker configuration, device
  environment is validated at registration, and live Apple environment evidence
  remains `NOT PASSED`; deployments that require strict environment separation
  must use separate backends/schedulers.
