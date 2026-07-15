# iOS 家長 App 資料合約

## 身分與租戶

- `organization_members`：admin／staff／teacher active membership；不可由 client metadata 取代。
- `parent_profiles`：organization-scoped guardian；`user_id` 連結 Auth user，並有 App account email/status。
- `parent_account_invitations`：每 organization + parent 的 idempotent 邀請／重發／接受／停用 audit 狀態。
- `parent_student_links`：家長可見學生的唯一關聯；所有課堂、出席、請假、補堂及財務 parent policy 都由此向下推導。

Admin Auth invitation 使用 server action。資料庫不保存臨時密碼、magic link 或 access token。

## 通知資料

`notifications` 保留 `title`、`detail`、`is_read` 兼容面，並加入：

- `organization_id`, `parent_id`, `recipient_user_id`
- `category`, `deep_link`, `entity_type`, `entity_id`
- `event_key`（organization 內唯一）
- `read_at`, `expires_at`, `source`, `actor_user_id`, `created_at`

`is_read` 與 `read_at` 必須由 migration/trigger 維持一致。App 不直接 update notification body；已讀變更只經 RPC。

`push_devices` 以 `installation_id` 表示 App installation，包含 user、由 server 推導的 organization、APNs token、sandbox/production、bundle id、非敏感版本資料及 active/invalidation timestamps。device token 不出現在 Admin UI 或普通查詢。

`notification_preferences` 分開 transactional、announcement、marketing、class reminder、attendance、leave/makeup、payment/receipt、quiet hours 和 timezone。marketing 預設 opt-out；交易／安全訊息不歸類為 marketing。

`notification_outbox` 每 notification + device 一 row，狀態至少有 pending、processing、retrying、delivered、would_send、dead_letter。lease owner/expiry 防止重複處理。

`notification_delivery_attempts` 保存 provider、request id、HTTP status、sanitized error、retry decision 和時間；不保存 APNs token、JWT、私鑰或完整 payload。

## App RPC

所有 App RPC 使用 `auth.uid()`，不接受 `organization_id`：

```text
register_push_device(
  p_installation_id text,
  p_device_token text,
  p_environment text,
  p_bundle_id text,
  p_app_version text default null,
  p_device_model text default null
)
deactivate_push_device(p_installation_id text)
mark_notification_read(p_notification_id uuid)
mark_all_notifications_read()
get_unread_notification_count() -> bigint
```

device registration 會驗證登入 parent 的 active account link、environment、bundle/token format，支援同帳號多裝置和 token rollover；登出只停用本 installation。

## Worker RPC

以下只授權 `service_role`：

```text
claim_notification_outbox(p_worker_id text, p_limit int, p_lease_seconds int)
complete_notification_delivery(..., p_delivery_status delivered|would_send)
retry_notification_delivery(..., p_retryable boolean, p_invalidate_device boolean)
```

claim 是單一 statement/transaction 的 `FOR UPDATE SKIP LOCKED` lease。complete/retry 必須同時驗證 row 仍由該 worker 持有；invalid token 更新同一 device；attempt audit 與 state transition 同一 transaction 完成。

## Deep-link contract

```text
tecm://notifications/{uuid}
tecm://bookings/{uuid}
tecm://leave-requests/{uuid}
tecm://makeups/{uuid}
tecm://payments/{uuid}
tecm://classes/{uuid}
```

只接受 `tecm` scheme、已知 path 和合法 UUID。解析失敗、資料已刪除或 RLS 不可見時回通知中心。

## 兼容與 migration

- migration 只 additive；不刪除舊 notification 或 booking bridge。
- backfill 必須使用 row 本身的 organization，而非任意 client tenant。
- 所有新 tenant table `ENABLE` + `FORCE RLS`、明確 grants、tenant indexes、unique/idempotency constraints 和 cross-tenant trigger/FK。
- fresh migration、既有 seed 及 repeatable seed 都是 release gate。
