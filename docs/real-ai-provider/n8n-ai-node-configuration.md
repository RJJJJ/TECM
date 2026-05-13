# n8n AI Node Configuration

## Upgrade steps

1. Keep the existing manual workflow as backup.
2. Replace the simulated AI Set node with the chosen provider node.
3. Pass `recommended_prompt` from `follow-up-preview` to the provider node.
4. Force JSON output using provider settings where available.
5. Add a validation Code node after the provider node.
6. If JSON parse fails, use fallback medium priority draft.
7. Do not leak API keys into workflow JSON.

## Pseudo validation Code node JavaScript

```javascript
const raw = $json.text || $json.output || $json.content || JSON.stringify($json);
let parsed;
try {
  parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (error) {
  parsed = null;
}

const fallback = {
  booking_id: $node['Set Config'].json.booking_id,
  channel: 'wechat_manual',
  priority: 'medium',
  intent_summary: 'AI 生成失敗，需要 staff 手動檢查預約資料。',
  suggested_message: '您好，我們收到您的預約查詢。為了協助安排合適課程，請問您方便確認孩子年級和希望預約的時段嗎？',
  suggested_next_steps: ['檢查預約資料', '確認孩子年級', '確認可預約時段'],
  internal_note: 'AI generation failed; fallback draft created for manual review.',
  source: 'n8n'
};

const allowedPriority = ['high', 'medium', 'low'];
if (!parsed || parsed.channel !== 'wechat_manual' || !allowedPriority.includes(parsed.priority) || !parsed.suggested_message) {
  return [{ json: fallback }];
}

return [{
  json: {
    booking_id: $node['Set Config'].json.booking_id,
    channel: parsed.channel,
    priority: parsed.priority,
    intent_summary: parsed.intent_summary || '',
    suggested_message: parsed.suggested_message,
    suggested_next_steps: Array.isArray(parsed.suggested_next_steps) ? parsed.suggested_next_steps : ['人工檢查'],
    internal_note: parsed.internal_note || '',
    source: 'n8n'
  }
}];
```
