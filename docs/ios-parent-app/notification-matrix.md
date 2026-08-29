# 通知事件 Matrix

| 事件 | category | 穩定 event key 範例 | 鎖屏文字 | deep link | 偏好 |
|---|---|---|---|---|---|
| 預約確認 | booking | `booking:{id}:confirmed` | 預約資料已有更新 | `/bookings/{id}` | transactional |
| 預約取消 | booking | `booking:{id}:cancelled` | 預約資料已有更新 | `/bookings/{id}` | transactional |
| 上課前 24 小時 | class_reminder | `class:{id}:reminder:24h` | 新的課堂提醒 | `/classes/{id}` | class_reminders |
| 上課前 2 小時 | class_reminder | `class:{id}:reminder:2h` | 新的課堂提醒 | `/classes/{id}` | class_reminders |
| 請假批准／拒絕 | leave | `leave:{id}:{status}` | 請假申請已有更新 | `/leave-requests/{id}` | leave_makeup |
| 補堂權益建立 | makeup | `makeup-entitlement:{id}:created` | 補堂安排已有更新 | `/makeups/{id}` | leave_makeup |
| 補堂安排／改期／取消 | makeup | `makeup:{id}:{status}:{revision}` | 補堂安排已有更新 | `/makeups/{id}` | leave_makeup |
| 缺席紀錄 | attendance | `attendance:{session}:{student}:absent` | 新的出席通知 | `/classes/{session}` | attendance |
| 堂數偏低／續堂提醒 | transactional | `credit:{package}:low:{threshold}` | 新的帳戶通知 | `/payments/{package}` | transactional |
| 收款完成 | payment | `payment:{id}:received` | 付款資料已有更新 | `/payments/{id}` | payment_receipt |
| 收據可查看 | receipt | `receipt:{id}:available` | 新收據可供查看 | `/payments/{id}` | payment_receipt |
| 教育中心公告 | announcement | `announcement:{id}` | 新的教育中心公告 | `/notifications/{id}` | announcements |

實際 key 必須由 immutable business id + transition/revision 組成，不含時間戳作唯一性替代。相同 transaction retry 只會取得既有 notification。

## 內容安全

鎖屏 payload 不含學生全名、醫療／請假原因、付款金額、私人課堂備註、Email、電話或 device token。完整 title/detail 只在登入 App 後經 RLS 取得。Apple 同樣建議 remote notification payload 不放 customer/sensitive data：[Generating a remote notification](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification)。

## 交易與 channel

- business row、notification 和 device outbox 盡量在同一 DB transaction 建立。
- trigger 可建立資料，不可發 HTTP。
- transactional/security 通知不當成 marketing；marketing 必須 explicit opt-in。
- quiet hours 可延後非緊急 outbox `available_at`，不可悄悄丟棄交易通知。
- WhatsApp/WeChat 維持 human-in-the-loop，這個 matrix 不會建立自動發送 node。
