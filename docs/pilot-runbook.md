# 澳門教育中心試點 Runbook

## 試點範圍

先選一個中心、一位管理員及兩位老師，使用 8–12 位非敏感測試學生跑一週。第一週不自動發送任何外部訊息；所有 WhatsApp/WeChat 內容先由職員核對。

## 開始前

1. 確認 organization、角色、時區 `Asia/Macau`、收費貨幣 MOP、低堂數門檻及請假期限。
2. 為老師建立個別登入，不共用 admin 帳戶。
3. 匯入班別、學生、套票及未清欠費；抽查總數與原 Excel 相符。
4. 執行 typecheck、unit、DB assertions、build 及可用的 E2E。
5. 在 Settings 產生/輪換 automation secret；n8n 不可存 service role key。

## 每日操作

- 早上：看 Dashboard 及 Today’s Sessions，處理未確認招生、低堂數及欠費。
- 上課：老師以手機開啟 Today’s Sessions，點入一節課，完成點名並確認成功狀態。
- 請假：職員建立 leave，核對是否符合補課規則，再安排有容量的 session。
- 收費：建立 charge/套票、記錄 payment，核對 outstanding 及 credit ledger。
- 晚上：處理未完成點名、缺席、請假及補課 backlog。

## 人工訊息

1. 在 Follow-ups 檢查家長、學生、原因及草稿。
2. 修改不合適或可能誤導的文字。
3. 人工複製到 WhatsApp/WeChat。
4. 回到 TECM 記錄聯絡時間、channel 及結果。

## 回復及事故

- 不刪除 ledger/audit；錯誤交易以 reversal entry 修正。
- 發現跨中心資料時立即停用涉事帳戶及 automation secret，保存 audit/request id，檢查 RLS 測試。
- automation 重複 task：停用 workflow，記錄 job/period/idempotency key，不能直接刪除歷史。
- 每日備份由 Supabase project policy 管理；試點前實際測一次 restore 到非 production project。

## 商業驗證

一週後量度：每日點名所需分鐘、未完成點名數、欠費跟進完成率、補課未安排天數、Excel/紙張減少量及職員願意付費的月費區間。下一步只針對最常用且最省時的流程迭代。

