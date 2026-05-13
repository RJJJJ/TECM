# TECM 5-minute Demo Script

## 1. Opening, 30 seconds

大家好，這個 demo 是 TECM，一個為澳門教育中心設計的 App + Admin + AI operations prototype。

家長可以透過 parent-facing iOS flow 查課程和預約；staff 可以在 Admin Web 管理預約、確認狀態，並使用 AI 協助生成 WeChat / WhatsApp 跟進話術。整個設計重點是提升 staff 跟進效率，同時保留人工確認，避免不安全的自動發送。

## 2. Product overview, 60 seconds

首先看 parent-facing flow：家長在 iOS concept 中瀏覽課程、查看資訊，然後提交 booking。這些 booking 會進入 Supabase，並在 Admin Web 中變成 staff 可管理的 structured data。

接著切到 Admin Web 的 `/admin/bookings`。這裡 staff 可以看到預約列表、狀態、家長與孩子資料。進入 booking detail 後，可以查看完整 booking context，並進行狀態更新，例如把 pending booking 確認為 confirmed。

## 3. AI follow-up, 90 seconds

下一步展示 `/admin/follow-ups`。這是 staff 的跟進 dashboard。

每一個 follow-up task 都包含 priority、channel、intent summary 和 suggested message。AI 的角色不是代替 staff，而是幫 staff 快速整理家長意向，產生可複製到 WeChat / WhatsApp 的繁體中文話術。

這裡可以看到高優先級 task、建議跟進訊息、copy button，以及 mark done / dismiss 操作。Staff 先確認內容，再手動複製給家長。完成後可以 mark done；如果不適用，可以 dismiss。

## 4. n8n automation, 90 seconds

現在切到 n8n manual workflow。這個 workflow 是安全的 v1 template：Manual Trigger 後設定 base URL、automation secret placeholder 和 booking ID。

Workflow 會先呼叫 `/api/automation/follow-up-preview` 取得 booking context 和 recommended prompt。接著 AI Output node 在 v1 template 中用 Set node 模擬 AI output，避免綁死任何 OpenAI、Gemini 或 Anthropic node。

最後 workflow 呼叫 `/api/automation/follow-up-tasks`，由 Admin Web server 負責驗證 secret、使用 server-side Supabase service role 建立或更新 follow-up task。回到 Admin Web，可以看到 `source=n8n` 的 task 已出現在 dashboard。

## 5. Safety / Macau fit, 30 seconds

澳門教育中心日常溝通常用 WeChat / WhatsApp，但 v1 不做自動發送。系統只生成 staff 可複製的話術，由 staff 人工確認後再發送。這樣可以降低帳號風險、合規風險，以及誤發訊息給家長的風險。

## 6. Closing, 30 seconds

這個 prototype 展示了 SwiftUI parent app、Next.js Admin Web、Supabase data layer、n8n workflow template，以及 AI-assisted operations。最重要的是，它採用 human-in-the-loop design：AI 提高效率，但最後對家長的溝通仍由 staff 負責確認和執行。
