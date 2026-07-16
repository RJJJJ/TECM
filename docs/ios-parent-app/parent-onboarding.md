# 家長帳號邀請與啟用

## 狀態機

```text
not_invited -> invited -> active
      |           |         |
      |           -> expired|
      |                     -> disabled
      └-------- resend/recover --------┘
```

狀態顯示來自 organization-scoped parent profile + invitation audit，不使用 user metadata 判斷角色。

## Admin 流程

1. admin/staff 以現有 session 進入家長頁；server action 重新驗證 active organization membership。
2. 選擇該 organization 已存在的 parent profile，輸入並正規化 Email。
3. server action 先查找既有 Auth user，並在任何 Email side effect 前拒絕已知的跨 organization／parent link 衝突。
4. server action 以 service role 呼叫 Supabase Auth invitation（redirect 指向 `tecm://auth/callback`），再由 DB RPC 重新驗證 link/tenant 並 idempotently 寫入 `parent_profiles.user_id` 及 invitation audit。
5. 重發先重用既有 Auth user/link，不建立第二個 link。Email 衝突、跨 tenant 或 Auth failure 顯示明確但不洩漏敏感資訊的錯誤。
6. 停用會撤銷 App tenant access 並停用該 user 的 push installations；不刪除營運／audit history。

只有 Auth Admin API 使用 service role；瀏覽器 bundle 和 client component 不可 import service-role client。

## iOS 啟用

- 保留 email/password 登入。
- invitation/magic link 以 `tecm://auth/callback` 回 App，交由 Supabase Auth session callback 處理。
- callback 成功後重新取得 session、canonical role/organization，再載入家長資料。
- 成功解析已邀請的 parent session 時呼叫 authenticated activation RPC，更新 profile/invitation audit；此步驟不依賴通知授權或 APNs token。
- callback 不合法、過期或被停用時顯示可恢復錯誤並返回登入畫面。
- 本 repo 沒有經驗證的 HTTPS associated domain／`apple-app-site-association`，因此本 release 不宣稱 Universal Links 已完成。

## 冪等與恢復

- organization + parent profile 只有一個 invitation state；normalized Email 有衝突時拒絕。
- Auth user 已存在時，只在 user/link/tenant 都相符才重用。
- Auth Email 成功但 DB link 失敗時保留 failed/retryable audit；重試會尋找相同 Auth user，不再建立新 user。
- Auth Email 與 PostgreSQL 不能形成單一交易；preflight 消除已知衝突，但兩步之間仍可能有 identity race。DB RPC 會拒絕該 race，且不建立第二個 link。
- Email delivery 失敗時不執行 DB link，並保留 failed/retryable audit。
- log 不保存 password、JWT、magic link、完整 Auth response 或私人家長資料。

## 本地驗證

使用 local Supabase/Inbucket 或 Auth mock 和 `@example.invalid`／本機 seed address。禁止向真實家長 Email、WhatsApp 或 WeChat 發送訊息。
