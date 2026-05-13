# AI Output Schema

## Required fields

| Field | Type | Rules |
| --- | --- | --- |
| `channel` | string | Must be `wechat_manual`. |
| `priority` | string | Must be `high`, `medium`, or `low`. |
| `intent_summary` | string | Traditional Chinese; suggested max 160 chars. |
| `suggested_message` | string | Traditional Chinese; suggested max 500 chars; parent-copyable. |
| `suggested_next_steps` | string array | 1-5 concise staff actions. |
| `internal_note` | string | Internal only; suggested max 300 chars. |

## Validation rules

- Output must be JSON only.
- No Markdown fences.
- No extra commentary.
- No auto-send wording.
- No invented seat availability or schedule guarantees.
- Missing required fields fail validation.

## Valid high priority example

```json
{
  "channel": "wechat_manual",
  "priority": "high",
  "intent_summary": "家長已指定 Python 體驗課並留下可聯絡電話，需要優先跟進。",
  "suggested_message": "您好，我們收到您的 Python 體驗預約。建議先了解孩子的學習背景，再協助安排合適班型。請問您方便確認預約時段嗎？",
  "suggested_next_steps": ["確認預約時段", "了解孩子學習經驗", "安排程度評估"],
  "internal_note": "高意向家長，建議當日跟進。"
}
```

## Valid medium priority example

```json
{
  "channel": "wechat_manual",
  "priority": "medium",
  "intent_summary": "家長對課程有興趣，但資料仍需補充。",
  "suggested_message": "您好，我們收到您的課程查詢。為了協助安排合適課程，請問孩子目前就讀年級和想加強的科目是甚麼？",
  "suggested_next_steps": ["補充孩子年級", "確認感興趣課程", "再安排試堂時間"],
  "internal_note": "資料不足，先補充需求。"
}
```

## Invalid: extra commentary

```text
Here is the JSON:
{ "channel": "wechat_manual" }
```

## Invalid: auto-send wording

```json
{
  "channel": "wechat_manual",
  "priority": "high",
  "intent_summary": "家長需要跟進。",
  "suggested_message": "我已自動發送 WeChat 給家長。",
  "suggested_next_steps": ["等待回覆"],
  "internal_note": "自動發送完成。"
}
```

## Invalid: invented guarantee

```json
{
  "channel": "wechat_manual",
  "priority": "high",
  "intent_summary": "家長想報名。",
  "suggested_message": "您好，我們保證已為孩子保留名額。",
  "suggested_next_steps": ["收費"],
  "internal_note": "未核實名額但承諾保留。"
}
```
