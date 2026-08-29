# iOS 家長 App 與推播架構

## 目標與邊界

TECM 只使用一個 Supabase project 及一個 PostgreSQL system of record。Next.js Admin Web 是行政工作介面；SwiftUI App 依登入角色提供家長中心、既有教師點名及有限的職員入口。App 不持有 service-role key 或 APNs 私鑰，也不直接呼叫 APNs。

```text
Admin Web (user JWT) ─┐
SwiftUI (user JWT) ───┼─> Supabase Auth/PostgREST/Realtime ─> PostgreSQL + RLS
                      │                                      │
Admin server action ──┘                                      └─ transaction -> notification + device outbox
  (service role only for Auth invitation)

Supabase Cron / protected scheduler -> send-apns Edge Function -> APNs HTTP/2 -> iPhone
                                              │
                                              └-> claim/complete/retry RPC + sanitized attempts
```

## 信任邊界

- iOS 和瀏覽器只使用 publishable/anon key 加用戶 JWT。所有資料權限由 RLS／tenant-safe RPC 決定，前端 tab 不是授權控制。
- Admin Web server action 先以用戶 JWT 驗證 active organization role，再只在伺服器使用 service role 呼叫 Supabase Auth Admin API。service-role key 不得使用 `NEXT_PUBLIC_` 前綴。
- APNs `.p8`、Key ID、Team ID 及 worker secret 只存在 Supabase Edge Function secret storage。
- `SECURITY DEFINER` function 固定 `search_path`、從 `auth.uid()` 推導用戶和 organization、撤銷 PUBLIC execute，再按需要授權 `authenticated` 或 `service_role`。
- PostgreSQL trigger 只建立 notification／outbox；外部 HTTP 由 Edge Function 執行。
- 鎖屏 payload 只含通用文字、`notification_id`、`category` 和 `tecm://` route。完整資料登入後經 RLS 讀取。

## 租戶與角色

`organization_members` 是 admin、staff、teacher 的 canonical membership。parent 不因加入家長 App 而獲得其他 member 的可見性；其 organization access 由已連結且未停用的 `parent_profiles.user_id` 推導。角色解析順序不會把 staff 提升為 admin，也不依賴可由 client 修改的 user metadata。

一個用戶可以有多個 active role。App 保留完整角色集合及 active organization context，再按角色顯示功能；任何寫入仍由資料庫重新驗證。

## 通知生命週期

1. 業務交易以穩定 `event_key` 建立 notification；相同事件重試命中 unique constraint。
2. 同一 transaction 為符合偏好且 active 的 device 建立一筆 outbox row。
3. worker 以 lease 原子 claim row；其他 worker 在 lease 到期前不能重複 claim。
4. APNs `200` 完成；`429`、`5xx`、timeout 指數退避；`410`、`Unregistered`、`BadDeviceToken` 停用 device；超過最大次數 dead-letter。
5. 每次 attempt 只記錄 provider request id、HTTP status、sanitized reason、retry decision 和時間。
6. Realtime 只是 UI 加速器；App 啟動、重連和 scene activation 都重新查詢 authoritative unread state。

## APNs 執行環境決策

採用 Supabase Edge Function，而不是新增 Node backend。Supabase Edge Functions 使用 Deno runtime、支援 Node/npm compatibility 及 server-side secrets；Deno `fetch` 會以 ALPN 自動協商 HTTP/2，符合 APNs provider API。實作使用 Web Crypto ES256 和標準 `fetch`，避免額外 APNs dependency。參考：[Supabase Edge Functions](https://supabase.com/docs/guides/functions)、[Supabase secrets](https://supabase.com/docs/guides/functions/secrets)、[Deno HTTP/2 fetch](https://docs.deno.com/examples/fetch_data_tutorial/)、[Apple remote notification server](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server)。

若 hosted runtime 未來移除所需 HTTP/2／Web Crypto 能力，才以 ADR 將相同 stateless worker 移到 trusted Node runtime；資料庫、RPC 和 outbox contract 不變。

## 故障與降級

- 沒有 APNs credential：只用 mock 或 `APNS_DRY_RUN=true`；outbox 標記 `would_send`，絕不標記 delivered。
- Realtime 中斷：snapshot query 和 unread-count RPC 仍可運作。
- invitation 外部呼叫失敗：保留可重試 audit row 和 sanitized error，不建立第二個 parent link。
- 未知／過期 deep link：導向通知中心，不 crash。
- 缺少 macOS、Apple entitlement 或真實裝置：列為 release blocker，不用文件敘述代替證據。
