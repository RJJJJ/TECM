# APNs 設定與操作手冊

## 1. Apple Developer 設定

1. 在 Apple Developer portal 確認 App ID 的 Bundle ID 與 Xcode `PRODUCT_BUNDLE_IDENTIFIER` 相同（預設 `app.TECM`）。
2. 為 App ID 啟用 Push Notifications capability。
3. 建立 APNs token signing key；按 sandbox/production policy 選擇 team-scoped 或 topic-specific key。下載 `.p8` 只有一次。
4. 記下 10 字元 Key ID 和 Team ID。不要把 `.p8`、certificate 或 provisioning profile 放入 repo。
5. Xcode target 加入 Push Notifications entitlement；Debug 使用 development APNs environment，TestFlight/App Store 使用 production。

Apple 要求 APNs provider 使用 HTTP/2 + TLS 及 ES256 token；provider token 超過一小時會失效。參考：[Token-based APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)、[APNs responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)。

## 2. Supabase secrets

在本機未追蹤的 env 或 Dashboard secret manager 設定：

```text
APNS_KEY_ID
APNS_TEAM_ID
APNS_BUNDLE_ID
APNS_PRIVATE_KEY
PUSH_WORKER_SECRET
APNS_DRY_RUN=true|false
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由 hosted Edge runtime 提供。可用 `supabase secrets set` 上傳；不要把值寫入 command history、workflow JSON 或文件。參考：[Supabase Edge secrets](https://supabase.com/docs/guides/functions/secrets)。

## 3. 部署與 scheduler

```powershell
supabase functions deploy send-apns --no-verify-jwt
```

Function 自行驗證 `Authorization: Bearer <PUSH_WORKER_SECRET>` 或 `x-tecm-worker-secret`。只讓 Supabase Cron／受信 scheduler 呼叫；不要建立公開無 secret 排程。每次只 claim 即將處理的一筆，APNs request 有 30 秒 timeout，active lease 與 notification/device unique key 防止重複排隊或並行處理。

APNs 與 PostgreSQL 不能形成單一交易，因此 delivery 是 at-least-once：若 APNs 已接受但資料庫 completion acknowledgement 失敗，backoff retry 或 lease 到期後可能重送。attempt/APNs request id 用於偵測及調查這個模糊狀態；文件不宣稱 exactly-once。

第一次部署先設 `APNS_DRY_RUN=true`。dry-run 只產生 `would_send` attempt，不標記 delivered。確認 tenant、recipient、environment 和 generic payload 後才在受控環境改為 false。

## 4. Sandbox、production 與 TestFlight

- Debug/development-signed build 註冊 sandbox token，送到 `api.sandbox.push.apple.com`。
- TestFlight/App Store build 註冊 production token，送到 `api.push.apple.com`。
- DB 保存每個 installation 的 environment；worker 逐 row 選 endpoint，不混用 token。
- TestFlight 驗證需要 Apple Developer account、production capability/profile、APNs key 及真實 iPhone。

## 5. 回應、重試與 token invalidation

- `200`：delivered。
- `429`、`500`、`503`、timeout：exponential backoff，保留 lease-safe retry。
- `410`、`Unregistered`、`BadDeviceToken`、`DeviceTokenNotForTopic`：停用 device，不重試該 token。
- 其他永久 4xx：dead-letter 或人工修正；不無限重試。
- attempt log 只保留 status、APNs request id 和 sanitized reason。

## 6. Key rotation

1. 建立第二把 APNs key並存入 secrets。
2. 部署/重啟 worker，確認新 key 在 sandbox 或 TestFlight 成功。
3. 在 Apple portal 撤銷舊 key。
4. 確認舊 provider connection 已關閉，監察 403/dead-letter。
5. 不把舊 key 留在本機共享資料夾、Git history 或 n8n export。

## 7. 本地與 simulator

mock provider 和 sender unit tests不需要 Apple credential。Simulator 可用無敏感資料的 `.apns` fixture：

```powershell
xcrun simctl push booted app.TECM docs/ios-parent-app/fixtures/notification.apns
```

Simulator injection 只驗證 App handling，不證明 APNs provider、entitlement、production token 或真實裝置交付。
