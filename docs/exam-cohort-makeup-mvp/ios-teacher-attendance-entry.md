# iOS Teacher Attendance Entry

This note documents the minimal iOS entry added after backend/admin/parent SQL E2E verification passed.

## What already passed before this UI entry

- Demo teacher / parent / student seed data created.
- Exam cohort, 12 lesson plans, and one lesson session created.
- Parent Center initial summary works.
- `submit_attendance(absent)` works through SQL/RPC.
- Absent attendance creates `makeup_tasks`.
- `/admin/makeup` shows missed lesson content and `makeup_guidance`.
- Parent Center makeup reminder updates.
- Reverse test `submit_attendance(present)` cancels/removes the open makeup reminder.

## Teacher entry location

The app now exposes the existing teacher attendance flow through the tab bar when the signed-in user resolves to:

- `teacher`, from an active `teacher_profiles` row; or
- `admin`, from an active staff role.

Normal parent users do not see the Teacher tab. If a parent somehow opens the teacher view directly, the screen shows a teacher-access message and does not load teacher sessions.

## Screens reused

- `TeacherTodayClassView`
  - Calls `get_teacher_today_sessions` through `ExamCohortService`.
  - Shows 今日課堂, cohort, lesson title, time, and `attendance_count/student_count`.
- `TeacherLessonSessionDetailView`
  - Shows lesson teaching content.
  - Opens the attendance marking screen.
- `TeacherAttendanceView`
  - Loads students through `get_lesson_session_students`.
  - Allows 出席 / 缺席 / 請假.
  - Submits through `submit_attendance` via `AttendanceService`.

## Test accounts

Use local/staging demo accounts only. Do not commit passwords.

### Teacher/admin test

Use `admin-test@tecm.com` only if that user has either:

- an active `teacher_profiles` row linked to the auth user; or
- an admin role plus a teacher profile if you expect `get_teacher_today_sessions` to return assigned sessions.

The RPC returns sessions assigned to the signed-in teacher profile, so an admin without a teacher profile may see the Teacher tab but no sessions.

### Parent test

Use `parent-test@tecm.com` to confirm:

- Teacher tab is not visible.
- Parent Center still shows only parent-facing booking/attendance/makeup summaries.
- Internal teacher attendance UI and internal makeup notes are not exposed.

## Manual iOS test steps

1. Launch the iOS app in Xcode.
2. Sign in as `admin-test@tecm.com` or a teacher test account with an active `teacher_profiles` row.
3. Confirm the tab bar shows `教師`.
4. Open `教師` → `今日課堂`.
5. Open the created lesson session.
6. Tap `學生出席`.
7. Mark `TECM 測試學生` as `缺席`.
8. Tap `提交出席紀錄`.
9. Confirm success message: `已提交，缺席學生會自動產生補課任務。`
10. Verify in Supabase:
    - `attendance_records` has an `absent` row for the session/student.
    - `makeup_tasks` has a pending/recommended task linked to the lesson plan.
11. Verify Admin Web:
    - `/admin/makeup` shows the task with missed lesson content and makeup guidance.
12. Sign in as `parent-test@tecm.com`.
13. Refresh Parent Center and confirm the makeup reminder appears.
14. Sign back in as teacher/admin.
15. Mark the same student `出席` and submit again.
16. Confirm the open makeup reminder is cancelled/removed after refresh.

## Build note

If this shell cannot run Xcode, run the iOS build manually in the VM/Xcode environment and record the result in the final regression report.

## Corrected teacher navigation behavior

Teacher attendance is role-gated to `teacher` and `admin`; normal parent users must not see or enter the teacher flow.

Expected navigation after this fix:

1. More -> `教師` opens `教師 / 今日課堂` at the root every time.
2. `今日課堂` -> `課堂詳情` opens the selected lesson session.
3. `課堂詳情` -> `學生出席` opens attendance marking.
4. Back from `學生出席` returns to `課堂詳情`.
5. Back from `課堂詳情` returns to `今日課堂`.
6. Back from `今日課堂` returns to More when the system places the Teacher tab under More.
7. Leaving the teacher flow and tapping `教師` again must reopen `今日課堂`, not the previous nested `學生出席` screen.

## Post-submit expected behavior

After a successful attendance submission:

- The success copy remains: `已提交，缺席學生會自動產生補課任務。`
- The teacher is not left in an ambiguous dead end.
- The screen shows clear actions:
  - `返回課堂詳情`
  - `完成並返回今日課堂`

## 12-student and longer-list manual test

Use a teacher/admin account with a lesson session containing at least 13 students, or temporarily preview/mock more than 12 students in the iOS preview only.

1. Open More -> `教師` -> `今日課堂`.
2. Open a lesson and tap `學生出席`.
3. Confirm all students are reachable by scrolling; there is no fixed 12-student cap.
4. Confirm each row remains compact and readable:
   - student name
   - school name when available
   - `出席 / 缺席 / 請假` control
5. Mark a mix of statuses for 12+ students.
6. Confirm the submit button remains reachable in the bottom action area while scrolling.
7. Submit and confirm the post-submit success copy and return actions above.
8. Tap `返回課堂詳情`, then back to `今日課堂`.
9. Leave the teacher flow, tap `教師` again, and confirm it starts at `今日課堂`.
