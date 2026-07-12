# TECM 教育中心營運助手：產品及技術審計

審計日期：2026-07-11  
基準 commit：`e7d0334087ea1545c51135c238544d89494b4433`  
工作分支：`education-ops-mvp-v2`

## 結論

現有 TECM 並非空白專案：Supabase、Next.js Admin Web、SwiftUI、n8n 範本已涵蓋招生查詢、課程、考試班、老師今日課堂、點名、補課 backlog 及人工跟進的部分流程。因此本次採用「兼容遷移 + 擴充現有 Admin Web」方案，不另建第二套產品。

目前版本仍未能作為教育中心的唯一營運紀錄。最大缺口是沒有 organization tenant 邊界、沒有收費與 immutable 堂數 ledger、沒有請假流程、沒有通用 audit log，而且沒有可重現的 migration、seed 和自動化驗收。

## 可重用功能

- Supabase Auth 與 Next.js SSR client：`admin-web/lib/supabase/*`。
- Staff 登入閘門、課程 CRUD、招生查詢、狀態歷史、人工跟進清單及複製訊息流程。
- `students`、`teacher_profiles`、`exam_cohorts`、`cohort_students`、`lesson_sessions`、`attendance_records`、`makeup_tasks`、`makeup_sessions` 等既有資料結構。
- 老師今日課堂、課堂學生及點名 RPC；時區已使用 `Asia/Macau`。
- attendance 唯一鍵、attendance-to-makeup trigger、booking notification bridge 及部分 follow-up retry 去重。
- SwiftUI 老師點名與家長中心可保留；MVP 不依賴 iOS 完成。
- n8n 已有 inactive、可匯入 JSON、人工覆核及 deterministic fallback 的結構範本。
- 既有 Admin Web production build 在審計基準上通過。

## Mock、fixture、placeholder 或模擬功能

- SwiftUI 仍包含 `TECM/MockData/MockDataStore.swift`，不可作營運資料真相。
- n8n real-AI 範本只屬配置範本；沒有 AI provider 時必須使用確定性模板，不會聲稱已連接模型。
- `tecm-pending-booking-polling-future-template.json` 所需 endpoint 不存在，現時不可運作。
- n8n AI 範本使用 `n8n_ai`／`n8n_staging_ai` source，但 API/DB 只接受 `n8n` 等既有 enum，會回傳 400。
- `docs/demo/screenshots` 只有預期檔名，並非實際 Playwright 證據。
- 現有 SQL 明確不包含可重現 demo seed；測試主要是人工 checklist 或 smoke script。

## 資料模型缺口

現有 21 項目標模型中，學生、課程、課堂、點名、跟進任務較完整；家長、老師、班別、報讀、補課及通訊只有部分表示；以下為關鍵缺口：

- 完全缺少 `organizations`、`leave_requests`、`fee_plans`、`student_packages`、`credit_ledger`、`charges`、`payments`、`audit_logs`。
- 所有現有營運表均沒有 `organization_id`，無法阻止跨中心讀寫。
- `staff_roles` 是全域角色，且 `is_staff_or_admin()` 令普通 staff 可管理角色，有提權風險。
- `children` 與 `students`、`parent_profiles` 與 guardian 概念重疊，需兼容而非破壞性改名。
- `cohort_students` 只近似 enrollment；沒有收費、套票及有效期生命週期。
- `makeup_tasks`／`makeup_sessions` 缺少清晰的 entitlement、到期、容量及原始請假關聯。
- 沒有不可變堂數 ledger；不能可靠推算餘額及防止重複扣堂。
- 沒有 invoice/charge/payment allocation，欠費及本月收款不能由資料庫可靠計算。
- `follow_up_tasks` 只以 booking 去重，無法支援按日／週期、低堂數、欠費及補課類型的 idempotency。

## 已確認資料庫缺陷

- `supabase_v1_schema.sql` 的驗證查詢後有未註解的 `order by tablename;`，會令檔案在建立 exam/attendance schema 前停止。
- teacher 直接寫 attendance 時，RLS 只驗證課堂負責人；學生是否屬於該班只在 RPC 內驗證。
- lesson plan 與 cohort 一致性及重複 session 只由應用程式 read-before-write 檢查，存在競態。
- 排補課及完成補課目前是多次非交易式寫入。
- `parent_student_links.parent_user_id` 與 `parent_profiles.user_id` 重複而無一致性約束。
- 刪除 session/attendance 會 cascade 影響歷史及補課紀錄，不適合正式審計需求。

## Admin Web 缺口

- 已有：Bookings、Follow-ups、Courses、Exam Cohorts、Makeup、Teachers（唯讀）、FAQ、News。
- 缺少：Dashboard、Students、Guardians、一般 Classes、Today’s Sessions、獨立 Attendance、Leave Requests、Packages & Credits、Charges & Payments、Settings、Audit Log。
- 導航是不可換行的八個橫向連結，手機／平板會溢出；列表主要依賴橫向捲動。
- staff/admin 現時權限相同；沒有 organization context。
- 沒有 unit、integration 或 Playwright 測試 runner。

## n8n、自動化及安全缺口

- 六個指定營運 workflow 均未完整存在；現有 scheduled digest 只處理 booking follow-up。
- automation endpoint 以單一全域 shared secret 驗證，沒有 organization scope、key id、request id 或審計身份。
- endpoint 使用 service role 只以 record id 查詢，現時可跨 tenant；本次必須改為每個 request 明確帶 organization 並驗證 scoped automation key。
- 現有 follow-up read-then-insert 在 concurrent retry 時可能一個成功、一個 500。
- workflow Set node 內放 secret 會進 execution data；交付範本須改用 n8n credential/header auth 或 env expression。
- 預設仍維持 human-in-the-loop，不加入 WhatsApp/WeChat 發送節點。

## 測試及部署缺口

- 沒有 `supabase/migrations`、`supabase/config.toml`、可執行 DB assertion 或 seed。
- 沒有 CI、Playwright 設定或自動化 E2E。
- 根目錄沒有 README、`.env.example` 及本次要求的 architecture/data-model/local-setup/pilot/acceptance 文件。
- Docker 存在並可使用本機 PostgreSQL image；Supabase CLI、n8n CLI 及 Xcode 在本機不可用。

## 本次採用架構

1. Supabase/PostgreSQL 繼續是唯一 system of record。
2. 新增增量 migration，建立 organization/member、guardian 兼容層、一般 class/enrollment、leave/makeup、finance/ledger、communication、follow-up 和 audit 模型；所有營運表加入 tenant 邊界。
3. 敏感操作透過 transaction RPC：報讀及購買、付款、點名扣堂、請假審批、排補課、automation upsert；以 organization-scoped idempotency key 防重。
4. 堂數以 append-only `credit_ledger` 求和；金額全部使用 `bigint` minor units。
5. 重做 RLS helper，區分 admin、staff、teacher，所有查詢及寫入受 organization membership 限制。
6. 擴充現有 Next.js Admin Web，以 server component 真實查詢 + guarded server action/RPC 完成營運流程；共用 responsive sidebar/topbar，預設繁體中文。
7. n8n 只呼叫 authenticated server-side automation endpoint；endpoint 內使用 service role，但 n8n 不取得 service role key。所有外部訊息只產生草稿及人工記錄。
8. SwiftUI 保留兼容，MVP 驗收以 responsive Admin Web 為主。
9. 本機驗收使用 Docker PostgreSQL 執行 migration/seed/SQL assertions，Next build/typecheck/unit tests 及 Playwright；缺少的外部環境會明確列為 `not run`。

## 不採用的方案

- 不加入 NocoDB、Vue、FastAPI、Redis 或 Dify；現有架構可安全完成 MVP。
- 不把 balance 欄位作唯一真相。
- 不自動發送 WhatsApp/WeChat。
- 不以 mock dashboard 或假 AI 代替資料庫流程。
