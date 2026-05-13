# TECM n8n Booking Follow-up Workflow

## 1. Why n8n is used

n8n is an external automation layer behind the existing TECM booking flow. It does **not** replace the iOS app, Supabase, or Admin Web. It is useful for:

- reacting to new `bookings` rows,
- preparing AI-assisted follow-up suggestions,
- creating internal staff reminders in `follow_up_tasks`,
- helping staff copy clear WeChat / WhatsApp wording for manual parent contact.

The canonical booking flow remains:

```text
iOS App -> Supabase bookings -> Admin Web
```

The new add-on flow is:

```text
Supabase booking event / n8n workflow -> AI suggestion -> follow_up_tasks -> Admin Web
```

## 2. Why not direct WeChat auto-send

Many Macau parents use WeChat, but direct personal WeChat automation is unstable and risky as a production dependency. Version 1 therefore uses **manual copy**: AI prepares a concise Traditional Chinese message, staff reviews it in Admin Web, then manually contacts the parent through WeChat / WhatsApp / phone.

No endpoint in this implementation sends WeChat messages automatically.

## 3. Architecture

```text
iOS App
  -> Supabase bookings
  -> n8n / automation
  -> follow_up_tasks
  -> Admin Web
  -> staff copies message
  -> WeChat / WhatsApp / phone manual follow-up
```

`follow_up_tasks` are internal staff-only records. Parents should not read them directly.

## 4. Required environment variables

Set these on the Admin Web deployment/runtime:

- `TECM_AUTOMATION_SECRET` — shared secret required in `x-tecm-automation-secret` for automation routes.
- `NEXT_PUBLIC_SUPABASE_URL` — existing Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — existing browser/session client key, if already required by Admin Web.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only key used by automation route handlers. Never expose it to frontend code.

Optional AI provider keys belong in n8n credentials, not in this repo.

## 5. n8n workflow nodes

Recommended workflow:

1. **Trigger**
   - Supabase webhook on `bookings` insert, or
   - scheduled polling for recent pending bookings without follow-up tasks, or
   - manual webhook for testing.
2. **HTTP Request**: `POST /api/automation/follow-up-preview`
   - sends `{ "booking_id": "..." }`
   - receives normalized booking data and `recommended_prompt`.
3. **AI node**
   - sends the prompt to your chosen AI provider in n8n.
   - returns strict JSON.
4. **Validate / Set node**
   - enforce `channel`, `priority`, and array fields.
5. **HTTP Request**: `POST /api/automation/follow-up-tasks`
   - creates or updates the open automation follow-up task.
6. **Optional daily digest**
   - notify staff about open high-priority tasks via an internal channel.

## 6. Example AI prompt

```text
你是 TECM 澳門教育中心的課程顧問助理。請根據 booking details，生成 staff 內部跟進建議。
不要聲稱已自動發送 WeChat。suggested_message 必須是可供 staff 複製到 WeChat / WhatsApp 的繁體中文人工跟進話術。

請只輸出嚴格 JSON：
{
  "channel": "wechat_manual",
  "priority": "high|medium|low",
  "intent_summary": "...",
  "suggested_message": "...",
  "suggested_next_steps": ["...", "..."],
  "internal_note": "..."
}
```

## 7. Example create payload

```json
{
  "booking_id": "52000000-0000-0000-0000-000000000001",
  "channel": "wechat_manual",
  "priority": "high",
  "intent_summary": "家長想了解 Python 入門是否適合已有 Scratch 經驗的孩子",
  "suggested_message": "陳太您好，這裡是 TECM 澳門教育中心。已收到您為孩子預約 Python 入門體驗課的資料。想先了解孩子是否有 Scratch 或其他編程經驗？我們可按程度安排合適的體驗內容。",
  "suggested_next_steps": ["確認星期六時段", "安排程度評估", "詢問 Scratch 學習經驗"],
  "internal_note": "已有 Scratch 經驗，高意向，可優先跟進",
  "source": "n8n"
}
```

Duplicate behavior: if an open automation/n8n task already exists for the same booking, the create endpoint updates that open task instead of inserting a duplicate.

## 8. Local testing with curl

Replace host, secret, and booking id as needed.

### Preview endpoint

```bash
curl -X POST http://localhost:3000/api/automation/follow-up-preview \
  -H "Content-Type: application/json" \
  -H "x-tecm-automation-secret: $TECM_AUTOMATION_SECRET" \
  -d '{"booking_id":"52000000-0000-0000-0000-000000000001"}'
```

### Create endpoint

```bash
curl -X POST http://localhost:3000/api/automation/follow-up-tasks \
  -H "Content-Type: application/json" \
  -H "x-tecm-automation-secret: $TECM_AUTOMATION_SECRET" \
  -d '{
    "booking_id":"52000000-0000-0000-0000-000000000001",
    "channel":"wechat_manual",
    "priority":"high",
    "intent_summary":"家長查詢 Python 入門體驗課",
    "suggested_message":"您好，這裡是 TECM 澳門教育中心。已收到您的體驗課預約，我們想先確認孩子的編程經驗，以便安排最合適的體驗內容。",
    "suggested_next_steps":["確認可上課時段","詢問孩子經驗"],
    "internal_note":"高意向，建議即日跟進",
    "source":"n8n"
  }'
```

### Invalid secret

```bash
curl -i -X POST http://localhost:3000/api/automation/follow-up-preview \
  -H "Content-Type: application/json" \
  -H "x-tecm-automation-secret: wrong" \
  -d '{"booking_id":"52000000-0000-0000-0000-000000000001"}'
```

Expected: `401` with safe JSON error.

### Invalid body

```bash
curl -i -X POST http://localhost:3000/api/automation/follow-up-tasks \
  -H "Content-Type: application/json" \
  -H "x-tecm-automation-secret: $TECM_AUTOMATION_SECRET" \
  -d '{"booking_id":"not-a-uuid"}'
```

Expected: `400` with a clear validation error.

### Duplicate task behavior

Run the create endpoint twice for the same booking while the existing automation task is still `open`. The second request should return:

```json
{ "ok": true, "task_id": "...", "booking_id": "...", "status": "updated" }
```

## 9. Parent notification bridge

The iOS app already has parent notifications. Keep parent-facing notifications separate from internal `follow_up_tasks`.

Current rule:

- AI follow-up suggestions are internal staff-only.
- Do **not** automatically notify parents when AI suggestions are generated.
- After a booking is confirmed, a future staff/admin workflow may create a parent-facing notification such as `您的體驗課預約已確認...`.

Future work can add a separate protected endpoint for parent notifications, but it should require the same automation secret/service-role protection and should only be used for parent-facing events approved by staff policy.

## 10. Acceptance checklist

- [ ] New booking can exist without a follow-up task.
- [ ] Follow-up task appears in Admin Booking Detail.
- [ ] Copy button works and never auto-sends WeChat.
- [ ] Mark done works.
- [ ] Dismiss works.
- [ ] Invalid automation secret is rejected.
- [ ] Service role secret is server-only and not exposed to frontend.
- [ ] iOS booking submission flow is unchanged.

## 11. Follow-up Dashboard

Admin Web now includes a daily operations queue:

```text
/admin/follow-ups
```

The dashboard shows all `follow_up_tasks` and defaults to `status=open`. Staff can filter by:

- status: all / open / done / dismissed
- priority: all / high / medium / low
- channel: all / WeChat / WhatsApp / phone / in-app
- booking date
- keyword across parent name, phone, child name, course, and intent summary

The page also shows summary cards for open tasks, high-priority open tasks, today booking follow-ups, and completed tasks.

## 12. Recommended staff workflow

1. Open `/admin/follow-ups` every morning.
2. Handle high-priority tasks first.
3. Review the AI suggestion and copy the WeChat / WhatsApp wording.
4. Contact the parent manually by WeChat, WhatsApp, or phone.
5. Mark the task as done after contact.
6. Dismiss irrelevant or stale tasks.
7. Open the linked Booking detail when staff need full booking context.

## 13. Parent notification distinction

`follow_up_tasks` are internal staff-only tasks. They may include AI intent summaries, suggested wording, and internal notes.

`notifications` are parent-facing App notifications. Do not send AI internal notes or follow-up suggestions to parents.

When staff confirm a booking in Admin Booking Detail, the booking update form can create a parent-facing App notification:

```text
預約已確認
```

The implementation uses `booking_parent_notifications` to avoid duplicate `booking_confirmed` notifications for the same booking.

## 14. Daily digest endpoint

n8n can request a staff-copyable digest without sending anything automatically:

```text
POST /api/automation/follow-up-digest
```

Security is the same as the other automation endpoints:

```http
x-tecm-automation-secret: <TECM_AUTOMATION_SECRET>
```

Request body is optional:

```json
{
  "status": "open",
  "date": "2026-05-13",
  "limit": 20
}
```

`limit` defaults to 20 and is capped at 50.

Example curl:

```bash
curl -X POST http://localhost:3000/api/automation/follow-up-digest \
  -H "Content-Type: application/json" \
  -H "x-tecm-automation-secret: $TECM_AUTOMATION_SECRET" \
  -d '{"status":"open","date":"2026-05-13","limit":20}'
```

Example response shape:

```json
{
  "ok": true,
  "summary": {
    "open_count": 3,
    "high_priority_open_count": 1,
    "today_booking_follow_up_count": 2,
    "done_count": 5
  },
  "items": [
    {
      "id": "...",
      "booking_id": "...",
      "priority": "high",
      "channel": "wechat_manual",
      "parent_name": "陳太",
      "phone": "...",
      "child_name": "...",
      "course_title_snapshot": "Python 入門",
      "booking_date": "2026-05-13",
      "start_time": "10:00:00",
      "intent_summary": "家長想確認孩子程度是否適合",
      "suggested_message": "...",
      "suggested_next_steps": ["確認時段", "詢問編程經驗"]
    }
  ],
  "digest_text": "今日 TECM 跟進摘要：..."
}
```

n8n can post `digest_text` into an internal staff workflow or prepare it for staff to manually copy into a WeChat work group. The endpoint does not send WeChat, WhatsApp, Telegram, or email.

## 15. Updated acceptance checklist

- [ ] `/admin/follow-ups` loads and defaults to open tasks.
- [ ] Dashboard filters work and preserve URL state.
- [ ] Copy suggested message works from dashboard.
- [ ] Mark done / dismiss works from dashboard.
- [ ] Booking Detail follow-up card still works.
- [ ] Booking confirmed can create parent App notification without duplicates.
- [ ] Invalid automation secret is rejected by digest endpoint.
- [ ] Digest endpoint returns useful Traditional Chinese `digest_text`.
- [ ] iOS booking flow remains unchanged.
