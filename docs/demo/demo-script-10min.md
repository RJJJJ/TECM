# TECM 10-minute Demo Script

## 1. Problem

澳門教育中心常見的營運問題是：家長查詢分散在 WeChat / WhatsApp，staff 需要手動整理資料和跟進。當預約量增加時，容易出現漏跟進、重複跟進，或高意向家長沒有被優先處理。

此外，預約後 staff 通常需要臨場撰寫話術，不同 staff 的溝通品質可能不一致。管理者也很難每天快速看到：還有多少待跟進、哪些是高優先級、哪些已完成。

## 2. Solution

TECM 把 booking 變成 structured data，並在 Admin Web 中提供 staff operations workflow。預約進入系統後，staff 可以查看 booking detail、更新狀態，並透過 follow_up_tasks 管理後續跟進。

AI follow-up layer 會幫 staff 生成 intent summary、priority 和 suggested message。Staff 不需要從零撰寫 WeChat / WhatsApp 話術，只需要審核、複製、手動發送，再把 task mark done。

Daily digest endpoint 和 n8n workflow 則提供每日摘要，幫管理者和 staff 快速掌握 open tasks、high priority tasks 和需要優先處理的家長。

## 3. Live demo path

1. 打開 Admin Web booking detail，展示家長、孩子、課程和預約資料。
2. 將 booking 從 pending 更新為 confirmed。
3. 說明 confirmed booking 會建立 parent notification bridge，讓 parent-facing notification 和 booking 關係可追蹤。
4. 打開 n8n manual workflow，執行 Manual Trigger。
5. 展示 `follow-up-preview` node 取得 booking context。
6. 展示 AI Output node 產生 channel、priority、intent summary、suggested message 和 next steps。
7. 展示 `follow-up-tasks` node 成功建立或更新 task。
8. 回到 `/admin/follow-ups`，展示 `source=n8n` task 已出現。
9. 展示 copy suggested message、mark done / dismiss。
10. 打開 n8n daily digest workflow，展示 digest summary 和 `digest_text`，說明 staff 可手動複製到 WeChat / WhatsApp 工作群。

## 4. Architecture explanation

TECM 包含五個主要部分：

- iOS App：parent-facing 課程瀏覽、預約和通知體驗。
- Admin Web：staff-facing booking management、follow-up dashboard 和 automation endpoints。
- Supabase：Postgres data layer，包含 bookings、courses、FAQ、notifications、follow_up_tasks 和 bridge tables。
- n8n：外部 automation layer，只呼叫 Admin Web automation endpoints。
- Staff manual follow-up：staff 審核 AI 文字後，手動使用 WeChat / WhatsApp 聯絡家長。

資料邊界很清楚：n8n 不直接接 Supabase service role；Admin Web server 才是 server-side authority。

## 5. Technical decisions

### Why n8n is external automation layer

n8n 適合負責 workflow orchestration，例如手動測試、未來排程 digest、串接不同 AI provider。把 workflow 放在 n8n，可以避免把營運流程硬寫死在產品核心邏輯中。

### Why service role stays in Admin Web

Supabase service role key 只應存在 server-side environment。n8n 只持有 `TECM_AUTOMATION_SECRET`，並透過 Admin Web automation endpoints 間接建立 follow-up tasks。這樣可降低 secret 外洩面積。

### Why no direct WeChat API

v1 不做 direct WeChat API 或 auto-send，因為個人 WeChat automation 不穩定且有合規與誤發風險。TECM v1 保留人工確認，讓 staff 複製已審核話術後再聯絡家長。

### Why follow_up_tasks are staff-only

`follow_up_tasks` 是內部營運資料，包含 AI 建議、優先級和 internal notes，不應直接暴露給家長。

### Why parent notifications are separate

Parent notifications 是 parent-facing communication；follow-up tasks 是 staff-facing operations。分開設計可以避免把內部營運建議誤顯示給家長。

## 6. Future work

- 在 n8n 內接入 real AI provider node，取代 v1 template 的 simulated AI output。
- 在人工流程穩定後加入 scheduled daily digest。
- 增加 staff assignment / owner field。
- 部署 staging environment 並設定 production-like env vars。
- 完成 iOS notification regression。
