# 資料模型

所有金額欄位均為 `bigint` minor units（MOP 1.00 = 100），時區以 `Asia/Macau` 解讀。所有 operational table 均以 `organization_id` 分隔。

RLS 負責使用者可見／可寫邊界；同 organization FK triggers 另外驗證每個關聯 UUID 的資料也屬同一中心，避免 Org A 的 row 指向 Org B 的學生、課堂、付款或其他實體。

| 領域 | 主表 | 真相／不變條件 |
|---|---|---|
| Tenant | `organizations`, `organization_members` | 一個 auth user 可在不同中心有不同角色 |
| 人物 | `parent_profiles`（guardian compatibility）、`students`, `teacher_profiles` | guardian/student/teacher 均屬 organization |
| 教學 | `courses`, `exam_cohorts`, `cohort_students`（enrollment compatibility）, `lesson_sessions` | enrollment 連結學生與班別；session 屬同一 organization |
| 點名 | `attendance_records` | session+student 唯一；只有已報讀學生可點名 |
| 請假補課 | `leave_requests`, `makeup_tasks`, `makeup_sessions` | 一次請假最多產生一次資格；預約不可超額 |
| 套票堂數 | `fee_plans`, `student_packages`, `credit_ledger` | balance = ledger entries sum；ledger 禁止 update/delete |
| 收費 | `charges`, `payments`, `payment_allocations` | outstanding = charges - allocated/refunded payments |
| 溝通 | `communication_logs`, `follow_up_tasks` | 草稿、人工聯絡時間及結果可審計 |
| 審計 | `audit_logs` | append-only；記錄 actor、動作、entity、before/after、request id |

## Ledger entry

正數代表加堂或退回，負數代表扣堂。`idempotency_key` 在 organization 內唯一。顯示餘額必須 `sum(delta_units)`，不能信任可修改 cache balance。

## 舊資料

migration 先建立 legacy organization，將無 tenant 的現有資料回填，再逐步加 `NOT NULL`、FK、索引及 RLS。`children` 可透過現有 `students.child_id` 兼容；不會刪除或批量重寫原始紀錄。
