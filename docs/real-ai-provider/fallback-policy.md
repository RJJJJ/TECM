# AI Fallback Policy

If AI generation fails or validation rejects output:

- Create a medium priority task.
- Use a safe template for `suggested_message`.
- Set `internal_note` to say AI generation failed and staff must review manually.
- Do not create a parent notification from failed AI.
- Do not send any WeChat / WhatsApp message automatically.
- Keep failure visible in n8n execution logs.

## Safe fallback draft

```json
{
  "channel": "wechat_manual",
  "priority": "medium",
  "intent_summary": "AI 生成失敗，需要 staff 手動檢查預約資料。",
  "suggested_message": "您好，我們收到您的預約查詢。為了協助安排合適課程，請問您方便確認孩子年級和希望預約的時段嗎？",
  "suggested_next_steps": ["檢查預約資料", "確認孩子年級", "確認可預約時段"],
  "internal_note": "AI generation failed; fallback draft created for manual review."
}
```
