# TECM Portfolio Writeup

## 1. Project summary

TECM is a full-stack education center prototype for Macau, combining a parent-facing SwiftUI app, a Next.js Admin Web dashboard, Supabase/PostgreSQL backend, and n8n-ready AI operations workflows.

## 2. Problem statement

Education centers often receive parent inquiries and trial lesson bookings through fragmented channels such as WeChat and WhatsApp. Staff need to manually track bookings, prioritize follow-up, write parent messages, and report daily progress. This can lead to missed follow-ups, inconsistent communication, and limited operational visibility.

## 3. My solution

I built a structured booking and operations workflow. Parent bookings are stored in Supabase, staff manage them through Admin Web, and AI-assisted follow-up tasks help staff prioritize and write clear manual follow-up messages. n8n workflow templates show how the automation layer can call Admin Web endpoints without directly accessing Supabase service credentials.

## 4. Tech stack

- SwiftUI
- Next.js
- Supabase
- PostgreSQL RLS
- n8n
- AI workflow

## 5. Key features

- Parent-facing course and booking flow
- Admin booking list and booking detail pages
- Booking status updates
- Confirmed booking parent notification bridge
- Staff follow-up dashboard
- AI follow-up suggestion card
- Automation endpoints for preview, task creation, and digest
- n8n manual follow-up workflow template
- n8n daily digest workflow template

## 6. AI design

The AI design is human-in-the-loop. AI suggests intent summaries, priorities, next steps, and staff-copyable Traditional Chinese messages. Staff review and manually copy messages to WeChat / WhatsApp. The system intentionally avoids unsafe auto-send behavior.

## 7. Backend/security design

Supabase stores structured data with RLS boundaries. Admin Web server-side routes keep the Supabase service role key on the server. n8n only receives `TECM_AUTOMATION_SECRET` and calls Admin Web automation endpoints. Internal `follow_up_tasks` remain staff-only and are separated from parent-facing notifications.

## 8. What I learned

This project reinforced the importance of designing AI features around real operational constraints: safety, staff review, data boundaries, and local communication habits. It also demonstrated how external workflow tools like n8n can extend a product without over-coupling automation logic to core business flows.

## 9. Future improvements

- Replace simulated AI output in the workflow template with a real AI provider node.
- Add scheduled daily digest after manual workflow validation.
- Add staff assignment and ownership fields.
- Deploy a staging environment with production-like configuration.
- Add automated regression tests and observability.
