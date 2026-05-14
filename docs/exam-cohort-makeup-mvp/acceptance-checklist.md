# Exam Cohort Attendance and Makeup Recovery MVP Acceptance Checklist

This checklist verifies only the MVP scope: lesson sessions can be created, teachers can submit attendance for active cohort students, absent lessons generate makeup backlog data, and parents see aggregate attendance/makeup summaries.

## Admin Web

- [ ] `/admin/exam-cohorts` loads for an active staff/admin user.
- [ ] `/admin/exam-cohorts/[id]` loads an existing cohort with students, lesson plans, recent attendance, and makeup counts.
- [ ] `/admin/exam-cohorts/[id]/lesson-plans` can save the 12 lesson plans with `teaching_content` and `makeup_guidance`.
- [ ] `/admin/exam-cohorts/[id]/lesson-sessions` loads.
- [ ] Staff can create a lesson session with a lesson plan, active teacher, start time, end time, and status.
- [ ] Lesson session creation rejects missing required fields.
- [ ] Lesson session creation rejects an end time that is not after the start time.
- [ ] Lesson session creation rejects a lesson plan from another cohort.
- [ ] Lesson session creation rejects an inactive or unknown teacher.
- [ ] Lesson session creation rejects an obvious duplicate cohort + lesson plan + start time.
- [ ] Created lesson sessions appear in the lesson sessions table.

## Teacher iOS Attendance

- [ ] Teacher attendance screen shows today’s sessions using the Asia/Macau day boundary.
- [ ] Teacher can open a session and see active students in the cohort.
- [ ] Teacher can submit `present`, `absent`, or `excused` attendance.
- [ ] Attendance submission succeeds for active students in the session cohort.
- [ ] Attendance submission rejects any `student_id` that is not active in the session cohort.
- [ ] Submitting absent/excused attendance creates or updates the makeup backlog through the existing database trigger.

## Makeup Backlog

- [ ] `/admin/makeup` shows pending/recommended makeup tasks for absent or excused students.
- [ ] Makeup task includes the missed lesson and lesson plan context.
- [ ] Missed lesson `teaching_content` and `makeup_guidance` can be identified from the linked lesson plan.
- [ ] `/admin/makeup/[id]` shows enough detail for staff to plan recovery.

## Parent iOS Summary

- [ ] Parent center aggregate attendance summary loads.
- [ ] Summary counts are not multiplied by makeup task joins.
- [ ] Attendance rate fallback shows `未有紀錄` when no attendance has been recorded.
- [ ] Makeup reminder copy is readable Traditional Chinese.
- [ ] Parent-facing views do not expose internal staff-only makeup task notes beyond aggregate reminders.

## Out of Scope for this MVP

- [ ] No production scheduler is enabled.
- [ ] No automatic WeChat / WhatsApp send is added.
- [ ] No iOS dependency on n8n is introduced.
- [ ] No new Supabase tables are required beyond the existing schema.

