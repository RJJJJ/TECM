import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { repositoryWorkflowIsValid } from './repository-workflow-contract.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const m40AcceptanceMode = process.argv.includes('--m40-acceptance');
const databaseProbeTimeoutMilliseconds = 1_200_000;
const testPath = 'admin-web/tests/unit/teacher-attendance-history.test.ts';
const verifierPath = 'scripts/testing/teacher-attendance-history-mutation-verify.mjs';
const databaseVerifierPath = 'scripts/testing/database-verify.ps1';
const contentionCompetitorPath = 'supabase/tests/concurrency/teacher_attendance_contention_competitor.sql';
const m40SemanticPrefix = '@@TECM_M40_SEMANTIC@@';
const m40SemanticSchema = 'tecm.m40.semantic.v2';
const m40SemanticProducer = 'database-verify.ps1/Invoke-TeacherAttendanceContention';
const m40SidecarPathEnvironment = 'TECM_M40_SEMANTIC_RECORD_PATH';
const m40SidecarCorrelationEnvironment = 'TECM_M40_SEMANTIC_CORRELATION';
const m40SidecarMaximumBytes = 16 * 1024;
const m40LifecycleCandidateLine = '[M40 LIFECYCLE] SEMANTIC_CANDIDATE_READY';
const m40LifecycleFinalizationLine = '[M40 LIFECYCLE] FINALIZATION_PASS';
const m40LifecycleSidecarLine = '[M40 LIFECYCLE] SIDECAR_COMMITTED';
const m40ExpectedTermination = 'M40_BLOCKING_CONTENTION_CAUGHT';
const m40ExpectedTerminationLine = `[M40 EXPECTED TERMINATION] ${m40ExpectedTermination}`;
const m40ExpectedTerminalFailure = 'M40_EXPECTED_TERMINAL_FAILURE';
const m40TerminalPrefix = '@@TECM_M40_TERMINAL@@';
const m40TerminalSchema = 'tecm.m40.terminal.v1';
const m40TerminalProducer = 'database-verify.ps1/outer-finalization';
const negativePreflightSummary = '[PASS] negative_preflight=PASS';
const databaseFailureDiagnostic = 'OperationStopped: (DATABASE_VERIFIER_FAILED:String) [], InvalidOperationException';
const m40KnownRejectionCodes = new Set([
  'M40_BARRIER_CLEANUP_FAILED',
  'M40_COMPETITOR_JOB_RECEIVE_FAILED',
  'M40_COMPETITOR_JOB_TIMEOUT',
  'M40_CONTENTION_OPERATION_FAILED',
  'M40_HOLDER_EMERGENCY_RELEASE_FAILED',
  'M40_HOLDER_JOB_FAILED',
  'M40_HOLDER_JOB_RECEIVE_FAILED',
  'M40_HOLDER_JOB_TIMEOUT',
  'M40_HOLDER_READINESS_FAILED',
  'M40_HOLDER_READINESS_INSPECTION_FAILED',
  'M40_HOLDER_RELEASE_FAILED',
  'M40_JOB_DRAIN_FAILED',
  'M40_JOB_REMOVE_FAILED',
  'M40_JOB_STOP_FAILED',
  'M40_POST_CANDIDATE_ASSERTION_FAILED',
  'M40_POST_CANDIDATE_SQL_22023',
  'M40_POST_SIDECAR_SQL_22023',
  'M40_SEMANTIC_RECORD_UNEXPECTED',
  'M40_SIDECAR_WRITE_FAILED',
  'M40_TERMINAL_CLEANUP_FAILED',
  'M40_TERMINAL_FINALIZATION_FAILED',
  'M40_TERMINAL_SIDECAR_STATE_INVALID',
  'M40_UNAUTHORIZED_MARKER_OBSERVED',
  'M40_UNEXPECTED_POST_SIDECAR_FAILURE',
  'M40_UNRELATED_SQL_FAILURE'
]);
const m40DiagnosticRejectionCodes = Object.freeze({
  baselineMismatch: 'M40_DIAGNOSTIC_BASELINE_MISMATCH',
  privatePath: 'M40_DIAGNOSTIC_PRIVATE_PATH_EXPOSURE',
  postSentinel: 'M40_POST_SENTINEL_DIAGNOSTIC_OBSERVED',
  rawM40Sql: 'M40_RAW_M40_SQL_DIAGNOSTIC_EXPOSURE',
  sensitive: 'M40_SENSITIVE_DIAGNOSTIC_EXPOSURE',
  sidecarPayload: 'M40_SIDECAR_PAYLOAD_EXPOSURE',
  terminalErrorRecord: 'M40_TERMINAL_ERROR_RECORD_OBSERVED',
  unclassified: 'M40_DIAGNOSTIC_UNCLASSIFIED'
});
const expectedPreterminalDiagnosticCounts = new Map([
  ['supabase/migrations/202607110000_legacy_baseline.sql|NOTICE', 71],
  ['supabase/migrations/202607110002_invariants_rls_rpcs.sql|NOTICE', 72],
  ['supabase/migrations/202607150004_parent_notifications.sql|NOTICE', 38],
  ['supabase/tests/concurrency/000_setup.sql|NOTICE', 1],
  ...(m40AcceptanceMode ? [] : [
    ['supabase/tests/concurrency/batch1_race_setup.sql|NOTICE', 3],
    ['supabase/tests/concurrency/course_link_enroll_setup.sql|NOTICE', 1],
    ['supabase/tests/concurrency/outbox_setup.sql|NOTICE', 1]
  ])
]);
const expectedPreterminalNoticeCount = [...expectedPreterminalDiagnosticCounts.values()]
  .reduce((total, count) => total + count, 0);
// Fixed NOTICE inventory: each source/line/severity/message occurs exactly once.
// Reviewed against SQL statements and saved 182/187 baseline outputs; never
// derived from the output being classified. No dynamic message wildcard.
const approvedNoticeInventory = {
  "supabase/tests/concurrency/000_setup.sql": [
    [3,"table \"__test_race_barrier\" does not exist, skipping"]
  ],
  "supabase/tests/concurrency/batch1_race_setup.sql": [
    [38,"column \"credit_count\" of relation \"__test_batch1_effect_baseline\" already exists, skipping"],
    [39,"column \"leave_count\" of relation \"__test_batch1_effect_baseline\" already exists, skipping"],
    [40,"column \"entitlement_count\" of relation \"__test_batch1_effect_baseline\" already exists, skipping"]
  ],
  "supabase/tests/concurrency/outbox_setup.sql": [
    [4,"table \"__test_outbox_claim_barrier\" does not exist, skipping"]
  ],
  "supabase/tests/concurrency/course_link_enroll_setup.sql": [
    [3,"table \"__test_course_link_race_outcomes\" does not exist, skipping"]
  ],
  "supabase/migrations/202607110000_legacy_baseline.sql": [
    [320,"trigger \"trg_staff_roles_updated_at\" for relation \"public.staff_roles\" does not exist, skipping"],
    [325,"trigger \"trg_parent_profiles_updated_at\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [330,"trigger \"trg_children_updated_at\" for relation \"public.children\" does not exist, skipping"],
    [335,"trigger \"trg_campuses_updated_at\" for relation \"public.campuses\" does not exist, skipping"],
    [340,"trigger \"trg_courses_updated_at\" for relation \"public.courses\" does not exist, skipping"],
    [345,"trigger \"trg_news_items_updated_at\" for relation \"public.news_items\" does not exist, skipping"],
    [350,"trigger \"trg_faq_items_updated_at\" for relation \"public.faq_items\" does not exist, skipping"],
    [355,"trigger \"trg_bookings_updated_at\" for relation \"public.bookings\" does not exist, skipping"],
    [360,"trigger \"trg_follow_up_tasks_updated_at\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [366,"trigger \"trg_bookings_status_log\" for relation \"public.bookings\" does not exist, skipping"],
    [395,"policy \"campuses_public_read_active\" for relation \"public.campuses\" does not exist, skipping"],
    [401,"policy \"courses_public_read_active\" for relation \"public.courses\" does not exist, skipping"],
    [407,"policy \"course_tags_public_read\" for relation \"public.course_tags\" does not exist, skipping"],
    [413,"policy \"news_public_read_active\" for relation \"public.news_items\" does not exist, skipping"],
    [419,"policy \"faq_topics_public_read\" for relation \"public.faq_topics\" does not exist, skipping"],
    [425,"policy \"faq_items_public_read_active\" for relation \"public.faq_items\" does not exist, skipping"],
    [432,"policy \"parent_profiles_select_own\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [438,"policy \"parent_profiles_update_own\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [445,"policy \"children_select_own\" for relation \"public.children\" does not exist, skipping"],
    [457,"policy \"children_insert_own\" for relation \"public.children\" does not exist, skipping"],
    [469,"policy \"children_update_own\" for relation \"public.children\" does not exist, skipping"],
    [488,"policy \"bookings_select_own\" for relation \"public.bookings\" does not exist, skipping"],
    [498,"policy \"bookings_insert_own_parent\" for relation \"public.bookings\" does not exist, skipping"],
    [508,"policy \"notifications_select_own\" for relation \"public.notifications\" does not exist, skipping"],
    [518,"policy \"notifications_update_own\" for relation \"public.notifications\" does not exist, skipping"],
    [534,"policy \"staff_roles_self_read\" for relation \"public.staff_roles\" does not exist, skipping"],
    [540,"policy \"staff_roles_admin_manage\" for relation \"public.staff_roles\" does not exist, skipping"],
    [547,"policy \"parent_profiles_staff_read\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [553,"policy \"children_staff_read\" for relation \"public.children\" does not exist, skipping"],
    [559,"policy \"campuses_staff_manage\" for relation \"public.campuses\" does not exist, skipping"],
    [566,"policy \"courses_staff_manage\" for relation \"public.courses\" does not exist, skipping"],
    [573,"policy \"course_tags_staff_manage\" for relation \"public.course_tags\" does not exist, skipping"],
    [580,"policy \"news_staff_manage\" for relation \"public.news_items\" does not exist, skipping"],
    [587,"policy \"faq_topics_staff_manage\" for relation \"public.faq_topics\" does not exist, skipping"],
    [594,"policy \"faq_items_staff_manage\" for relation \"public.faq_items\" does not exist, skipping"],
    [601,"policy \"bookings_staff_manage\" for relation \"public.bookings\" does not exist, skipping"],
    [608,"policy \"booking_logs_staff_manage\" for relation \"public.booking_status_logs\" does not exist, skipping"],
    [615,"policy \"follow_up_tasks_staff_manage\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [622,"policy \"notifications_staff_manage\" for relation \"public.notifications\" does not exist, skipping"],
    [629,"policy \"booking_parent_notifications_staff_manage\" for relation \"public.booking_parent_notifications\" does not exist, skipping"],
    [858,"trigger \"trg_students_updated_at\" for relation \"public.students\" does not exist, skipping"],
    [863,"trigger \"trg_teacher_profiles_updated_at\" for relation \"public.teacher_profiles\" does not exist, skipping"],
    [868,"trigger \"trg_exam_cohorts_updated_at\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [873,"trigger \"trg_lesson_plans_updated_at\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [878,"trigger \"trg_lesson_sessions_updated_at\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [883,"trigger \"trg_attendance_records_updated_at\" for relation \"public.attendance_records\" does not exist, skipping"],
    [888,"trigger \"trg_makeup_tasks_updated_at\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [893,"trigger \"trg_makeup_sessions_updated_at\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [913,"trigger \"trg_cohort_students_active_membership\" for relation \"public.cohort_students\" does not exist, skipping"],
    [932,"trigger \"trg_exam_cohorts_refresh_memberships\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [1053,"trigger \"trg_attendance_makeup_task\" for relation \"public.attendance_records\" does not exist, skipping"],
    [1070,"policy \"students_parent_summary_read\" for relation \"public.students\" does not exist, skipping"],
    [1078,"policy \"students_staff_manage\" for relation \"public.students\" does not exist, skipping"],
    [1084,"policy \"parent_student_links_parent_read\" for relation \"public.parent_student_links\" does not exist, skipping"],
    [1089,"policy \"parent_student_links_staff_manage\" for relation \"public.parent_student_links\" does not exist, skipping"],
    [1095,"policy \"teacher_profiles_self_read\" for relation \"public.teacher_profiles\" does not exist, skipping"],
    [1100,"policy \"teacher_profiles_staff_manage\" for relation \"public.teacher_profiles\" does not exist, skipping"],
    [1106,"policy \"exam_cohorts_teacher_read\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [1111,"policy \"exam_cohorts_staff_manage\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [1117,"policy \"cohort_students_teacher_read\" for relation \"public.cohort_students\" does not exist, skipping"],
    [1122,"policy \"cohort_students_staff_manage\" for relation \"public.cohort_students\" does not exist, skipping"],
    [1128,"policy \"lesson_plans_teacher_read\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [1133,"policy \"lesson_plans_staff_manage\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [1139,"policy \"lesson_sessions_teacher_read\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [1144,"policy \"lesson_sessions_staff_manage\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [1150,"policy \"attendance_teacher_write_own_session\" for relation \"public.attendance_records\" does not exist, skipping"],
    [1156,"policy \"makeup_tasks_teacher_read\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [1161,"policy \"makeup_tasks_staff_manage\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [1167,"policy \"makeup_sessions_teacher_read\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [1179,"policy \"makeup_sessions_staff_manage\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [1185,"policy \"makeup_recommendations_staff_manage\" for relation \"public.makeup_recommendations\" does not exist, skipping"]
  ],
  "supabase/migrations/202607110002_invariants_rls_rpcs.sql": [
    [72,"policy \"tenant_boundary\" for relation \"public.staff_roles\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.children\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.campuses\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.courses\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.course_tags\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.news_items\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.faq_topics\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.faq_items\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.bookings\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.booking_status_logs\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.notifications\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.booking_parent_notifications\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.students\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.parent_student_links\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.teacher_profiles\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.cohort_students\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.attendance_records\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [72,"policy \"tenant_boundary\" for relation \"public.makeup_recommendations\" does not exist, skipping"],
    [181,"trigger \"trg_children_tenant_fk\" for relation \"public.children\" does not exist, skipping"],
    [181,"trigger \"trg_courses_tenant_fk\" for relation \"public.courses\" does not exist, skipping"],
    [181,"trigger \"trg_course_tags_tenant_fk\" for relation \"public.course_tags\" does not exist, skipping"],
    [181,"trigger \"trg_faq_items_tenant_fk\" for relation \"public.faq_items\" does not exist, skipping"],
    [181,"trigger \"trg_bookings_tenant_fk\" for relation \"public.bookings\" does not exist, skipping"],
    [181,"trigger \"trg_booking_status_logs_tenant_fk\" for relation \"public.booking_status_logs\" does not exist, skipping"],
    [181,"trigger \"trg_follow_up_tasks_tenant_fk\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [181,"trigger \"trg_notifications_tenant_fk\" for relation \"public.notifications\" does not exist, skipping"],
    [181,"trigger \"trg_booking_parent_notifications_tenant_fk\" for relation \"public.booking_parent_notifications\" does not exist, skipping"],
    [181,"trigger \"trg_students_tenant_fk\" for relation \"public.students\" does not exist, skipping"],
    [181,"trigger \"trg_parent_student_links_tenant_fk\" for relation \"public.parent_student_links\" does not exist, skipping"],
    [181,"trigger \"trg_exam_cohorts_tenant_fk\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [181,"trigger \"trg_cohort_students_tenant_fk\" for relation \"public.cohort_students\" does not exist, skipping"],
    [181,"trigger \"trg_lesson_plans_tenant_fk\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [181,"trigger \"trg_lesson_sessions_tenant_fk\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [181,"trigger \"trg_attendance_records_tenant_fk\" for relation \"public.attendance_records\" does not exist, skipping"],
    [181,"trigger \"trg_makeup_tasks_tenant_fk\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [181,"trigger \"trg_makeup_sessions_tenant_fk\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [181,"trigger \"trg_makeup_recommendations_tenant_fk\" for relation \"public.makeup_recommendations\" does not exist, skipping"],
    [181,"trigger \"trg_leave_requests_tenant_fk\" for relation \"public.leave_requests\" does not exist, skipping"],
    [181,"trigger \"trg_makeup_entitlements_tenant_fk\" for relation \"public.makeup_entitlements\" does not exist, skipping"],
    [181,"trigger \"trg_fee_plans_tenant_fk\" for relation \"public.fee_plans\" does not exist, skipping"],
    [181,"trigger \"trg_student_packages_tenant_fk\" for relation \"public.student_packages\" does not exist, skipping"],
    [181,"trigger \"trg_credit_ledger_tenant_fk\" for relation \"public.credit_ledger\" does not exist, skipping"],
    [181,"trigger \"trg_charges_tenant_fk\" for relation \"public.charges\" does not exist, skipping"],
    [181,"trigger \"trg_payments_tenant_fk\" for relation \"public.payments\" does not exist, skipping"],
    [181,"trigger \"trg_payment_allocations_tenant_fk\" for relation \"public.payment_allocations\" does not exist, skipping"],
    [181,"trigger \"trg_communication_logs_tenant_fk\" for relation \"public.communication_logs\" does not exist, skipping"],
    [208,"trigger \"trg_credit_ledger_append_only\" for relation \"public.credit_ledger\" does not exist, skipping"],
    [211,"trigger \"trg_audit_logs_append_only\" for relation \"public.audit_logs\" does not exist, skipping"],
    [248,"trigger \"trg_organization_members_audit\" for relation \"public.organization_members\" does not exist, skipping"],
    [248,"trigger \"trg_cohort_students_audit\" for relation \"public.cohort_students\" does not exist, skipping"],
    [248,"trigger \"trg_attendance_records_audit\" for relation \"public.attendance_records\" does not exist, skipping"],
    [248,"trigger \"trg_leave_requests_audit\" for relation \"public.leave_requests\" does not exist, skipping"],
    [248,"trigger \"trg_makeup_entitlements_audit\" for relation \"public.makeup_entitlements\" does not exist, skipping"],
    [248,"trigger \"trg_makeup_tasks_audit\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [248,"trigger \"trg_makeup_sessions_audit\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [248,"trigger \"trg_student_packages_audit\" for relation \"public.student_packages\" does not exist, skipping"],
    [248,"trigger \"trg_credit_ledger_audit\" for relation \"public.credit_ledger\" does not exist, skipping"],
    [248,"trigger \"trg_charges_audit\" for relation \"public.charges\" does not exist, skipping"],
    [248,"trigger \"trg_payments_audit\" for relation \"public.payments\" does not exist, skipping"],
    [248,"trigger \"trg_payment_allocations_audit\" for relation \"public.payment_allocations\" does not exist, skipping"],
    [248,"trigger \"trg_communication_logs_audit\" for relation \"public.communication_logs\" does not exist, skipping"],
    [248,"trigger \"trg_follow_up_tasks_audit\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [274,"trigger \"trg_attendance_validate_enrollment\" for relation \"public.attendance_records\" does not exist, skipping"],
    [370,"trigger \"trg_attendance_credit_deduction\" for relation \"public.attendance_records\" does not exist, skipping"],
    [434,"trigger \"trg_payment_allocation_validate\" for relation \"public.payment_allocations\" does not exist, skipping"]
  ],
  "supabase/migrations/202607150004_parent_notifications.sql": [
    [156,"policy \"organization_staff_manage\" for relation \"public.parent_profiles\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.children\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.campuses\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.courses\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.course_tags\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.news_items\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.faq_topics\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.faq_items\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.bookings\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.booking_status_logs\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.follow_up_tasks\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.notifications\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.booking_parent_notifications\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.students\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.parent_student_links\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.teacher_profiles\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.exam_cohorts\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.cohort_students\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.lesson_plans\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.lesson_sessions\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.attendance_records\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.makeup_tasks\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.makeup_sessions\" does not exist, skipping"],
    [156,"policy \"organization_staff_manage\" for relation \"public.makeup_recommendations\" does not exist, skipping"],
    [386,"policy \"leave_requests_parent_insert\" for relation \"public.leave_requests\" does not exist, skipping"],
    [694,"trigger \"trg_organizations_updated_at\" for relation \"public.organizations\" does not exist, skipping"],
    [694,"trigger \"trg_organization_members_updated_at\" for relation \"public.organization_members\" does not exist, skipping"],
    [694,"trigger \"trg_leave_requests_updated_at\" for relation \"public.leave_requests\" does not exist, skipping"],
    [694,"trigger \"trg_makeup_entitlements_updated_at\" for relation \"public.makeup_entitlements\" does not exist, skipping"],
    [694,"trigger \"trg_fee_plans_updated_at\" for relation \"public.fee_plans\" does not exist, skipping"],
    [694,"trigger \"trg_student_packages_updated_at\" for relation \"public.student_packages\" does not exist, skipping"],
    [694,"trigger \"trg_charges_updated_at\" for relation \"public.charges\" does not exist, skipping"],
    [694,"trigger \"trg_parent_account_invitations_updated_at\" for relation \"public.parent_account_invitations\" does not exist, skipping"],
    [694,"trigger \"trg_push_devices_updated_at\" for relation \"public.push_devices\" does not exist, skipping"],
    [694,"trigger \"trg_notification_preferences_updated_at\" for relation \"public.notification_preferences\" does not exist, skipping"],
    [694,"trigger \"trg_notification_announcements_updated_at\" for relation \"public.notification_announcements\" does not exist, skipping"],
    [694,"trigger \"trg_notification_templates_updated_at\" for relation \"public.notification_templates\" does not exist, skipping"],
    [694,"trigger \"trg_notification_outbox_updated_at\" for relation \"public.notification_outbox\" does not exist, skipping"]
  ]
};
const approvedPreterminalNotices = new Map(Object.entries(approvedNoticeInventory)
  .filter(([source]) => expectedPreterminalDiagnosticCounts.has(source + '|NOTICE'))
  .flatMap(([source, notices]) => notices.map(([line, message]) =>
    [`psql:/workspace/${source}:${line}: NOTICE:  ${message}`, { source, line, severity: 'NOTICE', message, count: 1 }])));
const sourceFiles = [
  testPath,
  'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
  'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
  'admin-web/app/admin/attendance/page.tsx',
  'admin-web/components/teacher-attendance-form.tsx',
  'admin-web/components/admin-shell.tsx',
  'admin-web/lib/operations/actions.ts',
  'admin-web/lib/operations/errors.ts',
  'scripts/testing/database-verify.ps1',
  'supabase/tests/concurrency/teacher_attendance_contention_setup.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_holder.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_competitor.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_assert.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_retry_cleanup.sql'
];

const cases = [
  {
    id: 'M30',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '  if not exists (\n    select 1 from public.teacher_profiles tp',
    replacement: '  if false and not exists (\n    select 1 from public.teacher_profiles tp',
    expectedTest: 'teacher attendance history has server-enforced assignment, tenant, and write boundaries',
    expectedFailure: 'M30 assignment guard missing'
  },
  {
    id: 'M31',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: 'for each row execute function public.capture_attendance_history_audit();',
    replacement: 'for each row execute function public.capture_audit_log();',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M31 attendance history audit trigger missing',
    semanticMapping: {
      originalProperty: 'The attendance trigger must call capture_attendance_history_audit() so reason, request ID, actor, and status history are retained.',
      currentTarget: 'Migration 014 remains the effective trigger definition; the T8 revision migration does not replace this audit boundary.'
    }
  },
  {
    id: 'M32',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "if session_row.starts_at > now() then raise exception 'future session attendance is not allowed'; end if;",
    replacement: "if false then raise exception 'future session attendance is not allowed'; end if;",
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M32 future-session denial missing'
  },
  {
    id: 'M33',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '    new.revision := old.revision + 1;',
    replacement: '    new.revision := old.revision;',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M33 monotonic revision increment missing'
  },
  {
    id: 'M39',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '        or target_expected_revision <> attendance_row.revision then',
    replacement: '        or false then',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M39 stale revision equality guard missing'
  },
  {
    id: 'M40',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "  if not pg_try_advisory_xact_lock(hashtextextended(\n    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,\n    0\n  )) then\n    raise exception 'attendance update is already in progress';\n  end if;",
    replacement: "  perform pg_advisory_xact_lock(hashtextextended(\n    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,\n    0\n  ));",
    expectedTest: 'database existing/absent attendance contention proof',
    expectedFailure: 'm40_blocking_contention',
    databaseProbe: true,
    mutationTarget: 'non-blocking identity-scoped pg_try_advisory_xact_lock guard'
  }
];

class VerifierError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VerifierError';
    this.code = code;
    this.details = details;
    this.cleanup = 'UNKNOWN';
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function rawGitBlob(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function filteredGitBlob(bytes, relative) {
  const result = spawnSync('git', ['hash-object', `--path=${relative}`, '--stdin'], {
    cwd: repoRoot,
    input: bytes,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000
  });
  const blob = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(blob)) {
    throw new VerifierError('GIT_BLOB_FAILED', `Could not hash protected source: ${relative}`);
  }
  return blob;
}

function snapshot(bytes, relative) {
  return {
    bytes: Buffer.from(bytes),
    sha256: sha256(bytes),
    gitBlob: filteredGitBlob(bytes, relative),
    rawGitBlob: rawGitBlob(bytes)
  };
}

const sourceSnapshots = new Map(sourceFiles.map((relative) => {
  const bytes = readFileSync(resolve(repoRoot, relative));
  return [relative, snapshot(bytes, relative)];
}));

function repoRestorationEvidence() {
  const files = sourceFiles.map((relative) => {
    const current = readFileSync(resolve(repoRoot, relative));
    const original = sourceSnapshots.get(relative);
    const currentSha256 = sha256(current);
    const currentGitBlob = filteredGitBlob(current, relative);
    const currentRawGitBlob = rawGitBlob(current);
    return {
      file: relative,
      sha256: currentSha256,
      git_blob: currentGitBlob,
      raw_git_blob: currentRawGitBlob,
      restored: current.equals(original.bytes)
        && currentSha256 === original.sha256
        && currentGitBlob === original.gitBlob
        && currentRawGitBlob === original.rawGitBlob
    };
  });
  return { status: files.every(({ restored }) => restored) ? 'PASS' : 'FAIL', files };
}

function copyFixture(destination) {
  for (const relative of sourceFiles) {
    const from = resolve(repoRoot, relative);
    if (!existsSync(from)) throw new VerifierError('MISSING_INPUT', `missing mutation input: ${relative}`);
    const to = resolve(destination, relative);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function countOccurrences(text, search) {
  if (!search) throw new VerifierError('INVALID_MUTATION', 'mutation search text must not be empty');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(search, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + search.length;
  }
}

function textShape(bytes) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const decoded = bytes.toString('utf8');
  const text = hasBom ? decoded.slice(1) : decoded;
  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlfCount > 0 && lfCount === 0 ? 'CRLF' : 'LF';
  return { hasBom, text, eol, crlfCount, lfCount };
}

function encodeText(text, { hasBom, eol }) {
  const encodedText = eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
  const encoded = Buffer.from(encodedText, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]) : encoded;
}

const m40TraceSchema = 'tecm.m40.diagnostic.v1';
const m40TraceEventSchema = 'tecm.m40.diagnostic.event.v1';
const m40TraceProducer = 'database-verify.ps1/diagnostic';
const m40TraceMaximumBytes = 65536;
const r3PositivePhases = [
  'fixture_setup_started', 'fixture_setup_completed', 'session_setup_started',
  'session_setup_completed', 'slow_setup_started', 'slow_setup_completed',
  'statement_timeout_armed', 'rpc_started', 'rpc_finished', 'classification_completed',
  'holder_release_completed', 'job_cleanup_completed', 'barrier_cleanup_completed', 'outer_cleanup_completed'
];
const r3NegativePhases = [
  'fixture_setup_started', 'fixture_setup_completed', 'session_setup_started',
  'session_setup_completed', 'statement_timeout_armed', 'slow_setup_started',
  'holder_release_completed', 'job_cleanup_completed', 'barrier_cleanup_completed', 'outer_cleanup_completed'
];

function replaceSourceExactly(source, target, replacement) {
  const matches = countOccurrences(source, target);
  if (matches !== 1) throw new VerifierError('MATCH_COUNT', 'Source construction requires exactly one target', { matches });
  const offset = source.indexOf(target);
  const candidate = source.replace(target, () => replacement);
  if (candidate === source || candidate !== source.slice(0, offset) + replacement + source.slice(offset + target.length)) {
    throw new VerifierError('SOURCE_REPLACEMENT_INVALID', 'Source construction failed its exact splice contract');
  }
  return candidate;
}

function assertSqlDollarQuotes(source) {
  // This checks quoting, not SQL semantics. Bodies are opaque and delimiters are
  // matched byte-for-byte; single/double quotes and SQL comments are skipped.
  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth > 0) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new VerifierError('SQL_DOLLAR_QUOTE_INVALID', 'Disposable SQL quoting is incomplete');
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++]; let ended = false;
      while (i < source.length) {
        if (source[i++] !== quote) continue;
        if (source[i] === quote) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new VerifierError('SQL_DOLLAR_QUOTE_INVALID', 'Disposable SQL quoting is incomplete');
      continue;
    }
    const delimiter = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (delimiter) {
      const end = source.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new VerifierError('SQL_DOLLAR_QUOTE_INVALID', 'Disposable SQL dollar quote is incomplete');
      i = end + delimiter.length; continue;
    }
    if (/^do\s+\$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)/i.test(source.slice(i))) {
      throw new VerifierError('SQL_DOLLAR_QUOTE_INVALID', 'Disposable SQL DO delimiter is malformed');
    }
    i++;
  }
}

// Scan before JSON.parse can discard contradictory keys. Sets belong to each
// object, and string decoding uses JSON's own escape rules (including \uXXXX).
function parseM40Json(text) {
  let offset = 0;
  const invalid = () => { throw new SyntaxError('M40 JSON syntax, duplicate key, or depth invalid'); };
  const whitespace = () => { while (offset < text.length && /[ \t\r\n]/.test(text[offset])) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') return JSON.parse(text.slice(start, offset));
      if (char === '\\') offset++;
    }
    return invalid();
  };
  const value = depth => {
    whitespace();
    if (depth > 32) invalid();
    const char = text[offset];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      const object = char === '{', end = object ? '}' : ']';
      const keys = new Set();
      offset++; whitespace();
      if (text[offset] === end) { offset++; return; }
      for (;;) {
        if (object) {
          whitespace();
          if (text[offset] !== '"') invalid();
          const key = string();
          if (keys.has(key)) invalid();
          keys.add(key); whitespace();
          if (text[offset++] !== ':') invalid();
        }
        value(depth + 1); whitespace();
        if (text[offset] === end) { offset++; return; }
        if (text[offset++] !== ',') invalid();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!token) invalid();
    offset += token[0].length;
  };
  value(0); whitespace();
  if (offset !== text.length) invalid();
  return JSON.parse(text);
}

function inspectM40Trace({ bytes, correlation, startedAt, finishedAt, mtimeMs, mode = 'slow', cleanup = 'PASS', present = true }) {
  const rejected = code => ({ accepted: false, rejection_codes: [code], events: [], diagnostics: [], slow_duration_ms: null, cleanup });
  if (!present) return rejected('M40_TRACE_MISSING');
  if (cleanup !== 'PASS') return rejected('M40_TRACE_CLEANUP_FAILED');
  if (bytes.length > m40TraceMaximumBytes) return rejected('M40_TRACE_OVERSIZED');
  if (mtimeMs < startedAt) return rejected('M40_TRACE_STALE');
  if (mtimeMs > finishedAt) return rejected('M40_TRACE_LATE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return rejected('M40_TRACE_UTF8_INVALID'); }
  if (bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) || !text.endsWith('\n')
      || text.includes('\r') || text.slice(0, -1).includes('\n') || /[\x00-\x1f\x7f]/.test(text.slice(0, -1))) {
    return rejected('M40_TRACE_NEWLINE_INVALID');
  }
  let trace;
  try { trace = JSON.parse(text); } catch { return rejected('M40_TRACE_JSON_INVALID'); }
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
    && exactSortedSet(Object.keys(value), expected);
  if (!keys(trace, ['schema', 'correlation', 'producer', 'started_at_ms', 'completed_at_ms', 'events'])) return rejected('M40_TRACE_FIELDS_INVALID');
  if (trace.schema !== m40TraceSchema || trace.producer !== m40TraceProducer) return rejected('M40_TRACE_SCHEMA_INVALID');
  if (trace.correlation !== correlation || !/^[a-f0-9]{64}$/.test(trace.correlation)) return rejected('M40_TRACE_CORRELATION_INVALID');
  if (!Array.isArray(trace.events) || trace.events.length < 1 || trace.events.length > 128) return rejected('M40_TRACE_RECORD_COUNT_INVALID');
  // JSON.parse accepts duplicate properties; count decoded JSON keys in this
  // string-only/number/null schema independently before accepting the record.
  const keyTokens = [...text.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)].map(m => JSON.parse('"' + m[1] + '"'));
  const expectedKeyCount = 6 + 16 * trace.events.length;
  if (keyTokens.length !== expectedKeyCount) return rejected('M40_TRACE_FIELDS_INVALID');
  if (!Number.isFinite(trace.started_at_ms) || !Number.isFinite(trace.completed_at_ms)
      || trace.started_at_ms < startedAt || trace.completed_at_ms > finishedAt
      || trace.completed_at_ms < trace.started_at_ms) return rejected('M40_TRACE_TIME_INVALID');
  const allowedPhases = new Set([...r3PositivePhases, 'fixture_setup', 'phase_unknown', 'outer_failure']);
  const allowedClasses = new Set(['phase_completed', 'cleanup_failed', 'unclassified_diagnostic',
    'pre_rpc_statement_timeout', 'sql_fixture_error', 'outer_verifier_failure']);
  let lastAt = trace.started_at_ms;
  let lastSqlAt = null;
  for (const [index, event] of trace.events.entries()) {
    if (!keys(event, ['schema', 'correlation', 'producer', 'sequence', 'kind', 'phase', 'stream', 'at_ms',
      'elapsed_ms', 'sql_at_ms', 'sqlstate', 'classification', 'byte_count', 'digest', 'source', 'source_ordinal'])) return rejected('M40_TRACE_FIELDS_INVALID');
    if (event.schema !== m40TraceEventSchema || event.producer !== m40TraceProducer) return rejected('M40_TRACE_SCHEMA_INVALID');
    if (event.correlation !== correlation) return rejected('M40_TRACE_CORRELATION_INVALID');
    if (event.sequence !== index + 1) return rejected('M40_TRACE_SEQUENCE_INVALID');
    if (!allowedPhases.has(event.phase) || !allowedClasses.has(event.classification)
        || !['phase', 'diagnostic'].includes(event.kind) || !['none', 'stdout', 'stderr'].includes(event.stream)
        || !['verifier', 'competitor', 'fixture'].includes(event.source)
        || !Number.isInteger(event.source_ordinal) || event.source_ordinal < 0 || event.source_ordinal > 100) return rejected('M40_TRACE_PHASE_UNAUTHORIZED');
    if (event.sqlstate !== null && !/^[0-9A-Z]{5}$/.test(event.sqlstate)) return rejected('M40_TRACE_SQLSTATE_INVALID');
    if (!Number.isFinite(event.at_ms) || event.at_ms < trace.started_at_ms || event.at_ms > trace.completed_at_ms
        || (event.kind === 'phase' && event.at_ms < lastAt)) return rejected('M40_TRACE_TIME_INVALID');
    if (event.kind === 'phase') lastAt = event.at_ms;
    // The producer contract, never the input's source label, chooses the clock.
    const sqlPhase = ['session_setup_started', 'session_setup_completed', 'slow_setup_started',
      'slow_setup_completed', 'statement_timeout_armed', 'rpc_started', 'rpc_finished', 'classification_completed'].includes(event.phase);
    if (event.kind === 'phase' && requiredTracePhase(event.phase)) {
      if (event.source !== (sqlPhase ? 'competitor' : 'verifier')
          || event.stream !== (sqlPhase ? 'stderr' : 'none')) return rejected('M40_TRACE_PHASE_UNAUTHORIZED');
    }
    if (sqlPhase && event.kind === 'phase') {
      if (!Number.isFinite(event.sql_at_ms) || event.sql_at_ms < 1e12 || event.sql_at_ms >= 1e13
          || (lastSqlAt !== null && event.sql_at_ms < lastSqlAt)) return rejected('M40_TRACE_SQL_TIME_INVALID');
      lastSqlAt = event.sql_at_ms;
    } else if (event.sql_at_ms !== null) return rejected('M40_TRACE_SQL_TIME_INVALID');
    if (!Number.isFinite(event.elapsed_ms) || Math.abs(event.elapsed_ms - (event.at_ms - trace.started_at_ms)) > 0.002) return rejected('M40_TRACE_ELAPSED_INVALID');
    if (!Number.isInteger(event.byte_count) || event.byte_count < 0 || event.byte_count > 16384
        || (event.kind === 'diagnostic' ? !/^[a-f0-9]{64}$/.test(event.digest) || event.stream === 'none'
          : event.digest !== null || event.byte_count !== 0)) return rejected('M40_TRACE_METADATA_INVALID');
  }
  const phases = trace.events.filter(e => e.kind === 'phase').map(e => e.phase);
  const diagnostics = trace.events.filter(e => e.kind === 'diagnostic');
  const required = mode === 'pre-rpc' ? r3NegativePhases : r3PositivePhases;
  const codes = new Set();
  if (new Set(phases).size !== phases.length) codes.add('M40_TRACE_PHASE_DUPLICATE');
  else if (phases.some(p => !required.includes(p))) codes.add('M40_TRACE_RECORD_UNEXPECTED');
  else if (required.some(p => !phases.includes(p))) codes.add('M40_TRACE_PHASE_MISSING');
  else if (phases.some((p, i) => p !== required[i])) codes.add('M40_TRACE_PHASE_ORDER_INVALID');
  const eventAt = phase => trace.events.find(e => e.kind === 'phase' && e.phase === phase)?.sql_at_ms;
  const slowDuration = mode === 'pre-rpc' ? null : eventAt('slow_setup_completed') - eventAt('slow_setup_started');
  if (mode !== 'pre-rpc' && Number.isFinite(slowDuration) && (slowDuration < 3250 || slowDuration >= 5000)) codes.add('M40_TRACE_SLOW_DURATION_INVALID');
  if (trace.events.some(e => e.classification === 'cleanup_failed')) codes.add('M40_TRACE_CLEANUP_FAILED');
  if (diagnostics.some(e => !['pre_rpc_statement_timeout', 'outer_verifier_failure'].includes(e.classification))) codes.add('M40_TRACE_DIAGNOSTIC_UNCLASSIFIED');
  if (mode === 'pre-rpc' && !diagnostics.some(e => e.phase === 'slow_setup_started'
      && e.sqlstate === '57014' && e.classification === 'pre_rpc_statement_timeout')) codes.add('M40_TRACE_PRE_RPC_DIAGNOSTIC_MISSING');
  return { accepted: codes.size === 0, rejection_codes: [...codes].sort(), events: trace.events,
    diagnostics, slow_duration_ms: Number.isFinite(slowDuration) ? slowDuration : null,
    unknown_diagnostic_count: diagnostics.filter(e => !['pre_rpc_statement_timeout', 'outer_verifier_failure'].includes(e.classification)).length,
    cleanup, schema: trace.schema, semantic_authority: false };
}

const r4SyntheticScript = [
  "param([string]$Verifier,[string]$TemporaryRoot,[string]$Correlation)",
  "$ErrorActionPreference = 'Stop'",
  "$ContentionHardTimeoutSeconds = 3",
  "$m40TraceEnabled = $false",
  "$ownedJobs = [Collections.Generic.List[object]]::new()",
  "$results = [Collections.Generic.List[object]]::new()",
  "$currentControl = 'setup'",
  "$failure = $null",
  "try {",
  "  if ($Correlation -cnotmatch '^[a-f0-9]{64}$') { throw 'R4_SYNTHETIC_CORRELATION_INVALID' }",
  "  $tokens=$null; $errors=$null",
  "  $ast=[Management.Automation.Language.Parser]::ParseFile($Verifier,[ref]$tokens,[ref]$errors)",
  "  if ($errors.Count) { throw 'R4_SYNTHETIC_AST_FAILED' }",
  "  foreach ($name in @('Initialize-M40JobReceiver','Write-M40WorkerPacket','Test-M40JobPacket','New-M40JobObservation',",
  "      'Receive-M40JobIncrement','Wait-M40JobTerminal','Add-M40JobLifecycle','Finalize-M40OwnedJobs')) {",
  "    $nodes=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))",
  "    if ($nodes.Count -ne 1) { throw 'R4_SYNTHETIC_FUNCTION_COUNT' }",
  "    . ([scriptblock]::Create($nodes[0].Extent.Text))",
  "  }",
  "  Initialize-M40JobReceiver",
  "  foreach ($mode in @('partial','boundary','polling','streams','sticky','identical','duplicate','verbose','debug','progress')) {",
  "    $currentControl=$mode",
  "    $jobCorrelation=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()",
  "    $ready=[IO.Path]::Combine($TemporaryRoot,$mode+'.ready')",
  "    $release=[IO.Path]::Combine($TemporaryRoot,$mode+'.release')",
  "    $job=Start-Job -Name ('tecm-r4-synthetic-'+$mode) -ScriptBlock {",
  "      param($Mode,$Ready,$Release,$Correlation,$Writer)",
  "      Set-Item -LiteralPath function:Write-M40WorkerPacket -Value ([scriptblock]::Create($Writer))",
  "      $context=@{Correlation=$Correlation;Sequence=0;Clock=[Diagnostics.Stopwatch]::StartNew()",
  "        ChildState='NotStarted';ChildExitCode=$null}",
  "      if ($Mode -in @('partial','boundary','polling','sticky','duplicate')) {",
  "        Write-M40WorkerPacket $context 'phase' 'session_setup_started'",
  "      }",
  "      if ($Mode -in @('partial','sticky')) {",
  "        Write-M40WorkerPacket $context 'phase' 'session_setup_completed'",
  "        Write-M40WorkerPacket $context 'phase' 'slow_setup_started'",
  "      }",
  "      [IO.File]::WriteAllText($Ready,'ready')",
  "      if ($Mode -eq 'polling') {",
  "        Start-Sleep -Milliseconds 150",
  "        Write-M40WorkerPacket $context 'phase' 'session_setup_completed'",
  "        Start-Sleep -Milliseconds 150",
  "        Write-M40WorkerPacket $context 'phase' 'slow_setup_started'",
  "      } elseif ($Mode -eq 'streams') {",
  "        Write-Output 'R4_OUTPUT_CANARY'",
  "        Write-Error 'R4_ERROR_CANARY' -ErrorAction Continue",
  "        Write-Warning 'R4_WARNING_CANARY'",
  "        Write-Information -MessageData 'R4_INFORMATION_CANARY' -InformationAction Continue",
  "      } elseif ($Mode -eq 'identical') {",
  "        $bytes=[Text.UTF8Encoding]::new($false).GetBytes('R4_IDENTICAL_CANARY')",
  "        $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()",
  "        Write-M40WorkerPacket $context 'diagnostic' 'session_setup_started' -Stream 'stdout' -Classification 'unclassified_diagnostic' -ByteCount $bytes.Length -Digest $digest",
  "        Start-Sleep -Milliseconds 100",
  "        Write-M40WorkerPacket $context 'diagnostic' 'session_setup_started' -Stream 'stdout' -Classification 'unclassified_diagnostic' -ByteCount $bytes.Length -Digest $digest",
  "      } elseif ($Mode -eq 'duplicate') {",
  "        $context.Sequence=0",
  "        Write-M40WorkerPacket $context 'phase' 'session_setup_started'",
  "        Start-Sleep -Seconds 30",
  "      } elseif ($Mode -eq 'verbose') {",
  "        Write-Verbose 'R4_VERBOSE_CANARY' -Verbose",
  "        Start-Sleep -Seconds 30",
  "      } elseif ($Mode -eq 'debug') {",
  "        Write-Debug 'R4_DEBUG_CANARY' -Debug",
  "        Start-Sleep -Seconds 30",
  "      } elseif ($Mode -eq 'progress') {",
  "        Write-Progress -Activity 'R4_PROGRESS_CANARY' -Status 'R4_PROGRESS_STATUS' -PercentComplete 10",
  "        Start-Sleep -Seconds 30",
  "      } elseif ($Mode -eq 'boundary') {",
  "        while (-not [IO.File]::Exists($Release)) { Start-Sleep -Milliseconds 10 }",
  "        Write-M40WorkerPacket $context 'phase' 'session_setup_completed'",
  "        [IO.File]::WriteAllText($Release+'.ack','emitted')",
  "        Start-Sleep -Seconds 30",
  "      } else { Start-Sleep -Seconds 30 }",
  "    } -ArgumentList $mode,$ready,$release,$jobCorrelation,${function:Write-M40WorkerPacket}.ToString()",
  "    $ownedJobs.Add($job)",
  "    $startup=[Diagnostics.Stopwatch]::StartNew()",
  "    while (-not [IO.File]::Exists($ready) -and $startup.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 10 }",
  "    if (-not [IO.File]::Exists($ready)) { throw 'R4_SYNTHETIC_STARTUP_FAILED' }",
  "    $observation=Wait-M40JobTerminal -Job $job -TimeoutSeconds $(if ($mode -in @('partial','boundary','sticky')) { 0.5 } else { 3 }) -Correlation $jobCorrelation",
  "    if ($mode -eq 'boundary') {",
  "      if (-not $observation.TimedOut) { throw 'R4_BOUNDARY_TIMEOUT_REQUIRED' }",
  "      [IO.File]::WriteAllText($release,'release-after-recorded-deadline')",
  "      $ack=[Diagnostics.Stopwatch]::StartNew()",
  "      while (-not [IO.File]::Exists($release+'.ack') -and $ack.Elapsed.TotalSeconds -lt 3) { Start-Sleep -Milliseconds 10 }",
  "      if (-not [IO.File]::Exists($release+'.ack')) { throw 'R4_BOUNDARY_LATE_EMISSION_MISSING' }",
  "    }",
  "    if ($mode -eq 'sticky') { $observation.CleanupCodes.Add('M40_JOB_STOP_FAILED') }",
  "    $cleanup=Finalize-M40OwnedJobs -Jobs @($job)",
  "    $expectedError=if ($mode -eq 'duplicate') { 'M40_JOB_PACKET_DUPLICATE_IDENTITY' }",
  "      elseif ($mode -in @('verbose','debug','progress')) { 'M40_JOB_STREAM_UNAUTHORIZED' } else { $null }",
  "    if (-not $observation.Removed -or $observation.ReceiveError -cne $expectedError) { throw 'R4_SYNTHETIC_CAPTURE_FAILED' }",
  "    if ($mode -eq 'sticky') {",
  "      if ($cleanup.JobsStopped -ne 'FAIL' -or $cleanup.JobsRemoved -ne 'FAIL') { throw 'R4_CLEANUP_FAILURE_NOT_STICKY' }",
  "    } elseif ($expectedError) {",
  "      if ($cleanup.JobsRemoved -ne 'FAIL') { throw 'R4_CAPTURE_FAILURE_NOT_STICKY' }",
  "    } elseif ($cleanup.JobsStopped -eq 'FAIL' -or $cleanup.JobsRemoved -ne 'PASS') { throw 'R4_SYNTHETIC_CLEANUP_FAILED' }",
  "    $results.Add([ordered]@{id=$mode;timed_out=$observation.TimedOut;deadline_at_ms=$observation.DeadlineAt",
  "      state_at_deadline=$observation.StateAtDeadline;final_state=$observation.State;polls=$observation.Polls",
  "      records=@($observation.Records.ToArray());lifecycle=@($observation.Lifecycle.ToArray())",
  "      cleanup_codes=@($observation.CleanupCodes.ToArray());decision_cleanup=$cleanup;actual_removal=$observation.Removed",
  "      receive_error=$observation.ReceiveError})",
  "  }",
  "} catch {",
  "  $failure=[ordered]@{code=$(if ($_.Exception.Message -cmatch '^R4_[A-Z_]+$') { $_.Exception.Message } else { 'R4_SYNTHETIC_EXCEPTION' })",
  "    control=$currentControl;line=$_.InvocationInfo.ScriptLineNumber",
  "    exception_type=$_.Exception.GetType().Name",
  "    capture_code=$(if ($null -ne $observation) { $observation.ReceiveError } else { $null })}",
  "} finally {",
  "  $remaining=@($ownedJobs | Where-Object { @(Get-Job -Id $_.Id -ErrorAction SilentlyContinue).Count -ne 0 })",
  "  if ($remaining.Count) { $lastCleanup=Finalize-M40OwnedJobs -Jobs $remaining }",
  "  $jobsClean=@($ownedJobs | Where-Object { @(Get-Job -Id $_.Id -ErrorAction SilentlyContinue).Count -ne 0 }).Count -eq 0",
  "}",
  "$document=[ordered]@{schema='tecm.m40.collector.controls.v1';correlation=$Correlation",
  "  result=$(if ($null -eq $failure -and $jobsClean) { 'passed' } else { 'failed' });controls=@($results.ToArray());failure=$failure;cleanup=$jobsClean}",
  "[Console]::Out.Write(($document | ConvertTo-Json -Depth 16 -Compress) + \"`n\")",
  "if ($failure -or -not $jobsClean) { exit 1 }",
  ""
].join('\n');

function inspectM40JobCapture({ bytes, correlation, startedAt, finishedAt, mtimeMs, present, cleanup = 'PASS' }) {
  const reject = code => ({ accepted: false, rejection_codes: [code], semantic_authority: false, evidence: null, cleanup });
  if (cleanup !== 'PASS') return reject('M40_JOB_CAPTURE_CLEANUP_FAILED');
  if (!present) return reject('M40_JOB_CAPTURE_MISSING');
  if (bytes.length > 131072) return reject('M40_JOB_CAPTURE_OVERSIZED');
  if (mtimeMs < startedAt || mtimeMs > finishedAt) return reject('M40_JOB_CAPTURE_FRESHNESS_INVALID');
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return reject('M40_JOB_CAPTURE_UTF8_INVALID'); }
  if (bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) || !text.endsWith('\n')
      || /[\r\n\x00-\x1f\x7f]/.test(text.slice(0, -1))) return reject('M40_JOB_CAPTURE_NEWLINE_INVALID');
  try { value = JSON.parse(text); } catch { return reject('M40_JOB_CAPTURE_JSON_INVALID'); }
  const fields = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && exactSortedSet(Object.keys(v), names);
  if (!fields(value, ['schema','correlation','semantic_authority','started_at_ms','deadline_at_ms','completed_at_ms',
    'timed_out','state_at_deadline','final_state','receive_error','polls','records','lifecycle','cleanup_codes','removed'])) return reject('M40_JOB_CAPTURE_FIELDS_INVALID');
  if (value.schema !== 'tecm.m40.job.capture.v1' || value.semantic_authority !== false) return reject('M40_JOB_CAPTURE_SCHEMA_INVALID');
  if (value.correlation !== correlation || !/^[a-f0-9]{64}$/.test(correlation)) return reject('M40_JOB_CAPTURE_CORRELATION_INVALID');
  if (![value.started_at_ms,value.deadline_at_ms,value.completed_at_ms].every(Number.isFinite)
      || value.started_at_ms < startedAt || value.completed_at_ms > finishedAt || value.deadline_at_ms <= value.started_at_ms
      || value.deadline_at_ms - value.started_at_ms > 30000 || value.completed_at_ms < value.started_at_ms) return reject('M40_JOB_CAPTURE_TIME_INVALID');
  if (!Array.isArray(value.records) || value.records.length > 512 || !Array.isArray(value.lifecycle) || value.lifecycle.length > 5
      || !Array.isArray(value.cleanup_codes) || value.cleanup_codes.some(c => !['M40_JOB_STOP_FAILED','M40_JOB_REMOVE_FAILED','M40_JOB_DRAIN_FAILED'].includes(c))
      || typeof value.timed_out !== 'boolean' || typeof value.removed !== 'boolean'
      || !['Completed','Failed','Stopped','Running','NotStarted'].includes(value.final_state)
      || (value.state_at_deadline !== null && !['Running','NotStarted','Blocked','Stopping'].includes(value.state_at_deadline))
      || (value.receive_error !== null && !/^(?:job_receive_failed|M40_JOB_[A-Z_]+)$/.test(value.receive_error))
      || !Number.isInteger(value.polls) || value.polls < 1) return reject('M40_JOB_CAPTURE_VALUE_INVALID');
  let packets = 0, keys = 15, previousReceived = value.started_at_ms;
  for (const [index, record] of value.records.entries()) {
    keys += 11;
    if (!fields(record, ['sequence','stream','correlation','received_at_ms','elapsed_ms','emitted_at_ms','timely',
      'byte_count','digest','classification','packet'])) return reject('M40_JOB_CAPTURE_FIELDS_INVALID');
    if (record.sequence !== index + 1 || record.correlation !== correlation
        || !['output','error','warning','information','verbose','debug'].includes(record.stream)
        || !['sanitized_worker_event','job_stream_record'].includes(record.classification)
        || !/^[a-f0-9]{64}$/.test(record.digest) || !Number.isInteger(record.byte_count) || record.byte_count < 0 || record.byte_count > 65536
        || !Number.isFinite(record.received_at_ms) || record.received_at_ms < previousReceived || record.received_at_ms > value.completed_at_ms
        || !Number.isFinite(record.elapsed_ms) || record.elapsed_ms < 0
        || record.timely !== ((record.emitted_at_ms ?? record.received_at_ms) <= value.deadline_at_ms)) return reject('M40_JOB_CAPTURE_RECORD_INVALID');
    previousReceived = record.received_at_ms;
    if (record.packet === null) continue;
    const p = record.packet; keys += 17;
    if (!fields(p, ['schema','producer','correlation','sequence','kind','phase','stream','at_ms','sql_at_ms','observed_at_ms',
      'worker_elapsed_ms','sqlstate','classification','byte_count','digest','child_state','child_exit_code'])) return reject('M40_JOB_CAPTURE_FIELDS_INVALID');
    if (p.schema !== 'tecm.m40.job.diagnostic.v1' || p.producer !== 'database-verify.ps1/worker-observer'
        || p.correlation !== correlation || p.sequence !== ++packets || packets > 256
        || !['phase','diagnostic','process'].includes(p.kind)
        || !['phase_unknown',...r3PositivePhases.slice(2,10)].includes(p.phase)
        || !['none','stdout','stderr'].includes(p.stream)
        || !['phase_completed','unclassified_diagnostic','pre_rpc_statement_timeout','worker_started',
          'child_started','child_running','child_exited','child_failed','child_terminated'].includes(p.classification)
        || !['NotStarted','Running','Exited','TerminationFailed','Unknown'].includes(p.child_state)
        || (p.child_exit_code !== null && !Number.isInteger(p.child_exit_code))
        || !Number.isFinite(p.at_ms) || p.at_ms < value.started_at_ms - 2000 || p.at_ms > record.received_at_ms
        || p.observed_at_ms !== record.emitted_at_ms || p.observed_at_ms < p.at_ms || p.observed_at_ms > record.received_at_ms
        || (p.sql_at_ms !== null && (p.kind !== 'phase' || p.stream !== 'stderr' || !Number.isFinite(p.sql_at_ms) || p.sql_at_ms < 1e12 || p.sql_at_ms >= 1e13))
        || !Number.isFinite(p.worker_elapsed_ms) || p.worker_elapsed_ms < 0 || p.worker_elapsed_ms > 60000
        || (p.sqlstate !== null && !/^[0-9A-Z]{5}$/.test(p.sqlstate))
        || !Number.isInteger(p.byte_count) || p.byte_count < 0 || p.byte_count > 16384
        || (p.kind === 'diagnostic' ? !/^[a-f0-9]{64}$/.test(p.digest) : p.digest !== null || p.byte_count !== 0)) return reject('M40_JOB_CAPTURE_PACKET_INVALID');
  }
  for (const [index, event] of value.lifecycle.entries()) {
    keys += 4;
    if (!fields(event, ['sequence','phase','at_ms','elapsed_ms']) || event.sequence !== index + 1
        || !Number.isFinite(event.at_ms) || event.at_ms < value.started_at_ms || event.at_ms > value.completed_at_ms
        || !Number.isFinite(event.elapsed_ms) || event.elapsed_ms < 0) return reject('M40_JOB_CAPTURE_LIFECYCLE_INVALID');
  }
  if ([...text.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].length !== keys) return reject('M40_JOB_CAPTURE_FIELDS_INVALID');
  const phases = value.lifecycle.map(e => e.phase);
  if (!['pre_stop_drain,stop_started,stop_terminal,post_stop_drain,removed',
    'pre_stop_drain,stop_terminal,post_stop_drain,removed'].includes(phases.join(','))) return reject('M40_JOB_CAPTURE_LIFECYCLE_INVALID');
  const codes = new Set();
  if (value.timed_out) codes.add('M40_COMPETITOR_JOB_TIMEOUT');
  if (value.receive_error) codes.add('M40_JOB_CAPTURE_RECEIVE_FAILED');
  if (!value.removed || value.cleanup_codes.length) codes.add('M40_JOB_CAPTURE_CLEANUP_FAILED');
  if (value.records.some(r => r.packet && !r.timely)) codes.add('M40_JOB_TRACE_LATE');
  return { accepted: codes.size === 0, rejection_codes: [...codes].sort(), semantic_authority: false, evidence: value, cleanup };
}

function r4DeadlineDiagnosis(capture) {
  const evidence = capture?.evidence;
  if (!evidence) return { conclusion: null, reason: 'durable_capture_unavailable' };
  const timely = evidence.records.filter(r => r.timely && r.packet).map(r => r.packet);
  const phases = timely.filter(p => p.kind === 'phase');
  const last = phases.at(-1) ?? null;
  const phaseNames = phases.map(p => p.phase);
  const processStates = timely.filter(p => p.kind === 'process');
  const state = processStates.at(-1) ?? null;
  const completed = p => phaseNames.includes(p);
  let conclusion = null;
  if (evidence.timed_out && state) {
    if (state.child_state === 'Exited') conclusion = 8;
    else if (!completed('session_setup_started')) conclusion = 1;
    else if (!completed('session_setup_completed')) conclusion = 2;
    else if (!completed('slow_setup_completed')) conclusion = completed('slow_setup_started') ? 3 : null;
    else if (!completed('statement_timeout_armed')) conclusion = 4;
    else if (!completed('rpc_started')) conclusion = 5;
    else if (!completed('rpc_finished')) conclusion = 6;
    else conclusion = 7;
  }
  const at = name => phases.find(p => p.phase === name)?.sql_at_ms ?? null;
  const slowStart = at('slow_setup_started'), slowEnd = at('slow_setup_completed');
  return { conclusion, last_competitor_phase: last?.phase ?? null,
    last_phase_at_ms: last?.at_ms ?? null, last_phase_elapsed_ms: last?.worker_elapsed_ms ?? null,
    slow_duration_ms: slowStart !== null && slowEnd !== null ? slowEnd - slowStart : null,
    slow_started_at_ms: slowStart, slow_completed_at_ms: slowEnd,
    timeout_armed_at_ms: at('statement_timeout_armed'), rpc_started_at_ms: at('rpc_started'),
    job_timed_out: evidence.timed_out, job_state_at_deadline: evidence.state_at_deadline,
    child_state: state?.child_state ?? null, child_state_observed_at_ms: state?.observed_at_ms ?? null,
    child_state_age_at_deadline_ms: state ? evidence.deadline_at_ms - state.observed_at_ms : null,
    child_started_observed: processStates.some(p => p.classification === 'child_started'),
    child_exit_code: state?.child_exit_code ?? null,
    observed_sqlstates: [...new Set(timely.map(p => p.sqlstate).filter(Boolean))],
    cleanup: capture.cleanup === 'PASS' && evidence.removed && evidence.cleanup_codes.length === 0 ? 'PASS' : 'FAIL' };
}

function inspectR4SyntheticProtocol(result, correlation) {
  const stdout = Buffer.from(result.stdout ?? ''), stderr = Buffer.from(result.stderr ?? '');
  const counts = { stdout_bytes: stdout.length, stderr_bytes: stderr.length, final_documents: 0,
    additional_json_records: 0, unclassified_stdout_records: 0, unexpected_stderr_records: stderr.length ? 1 : 0 };
  const fail = code => ({ accepted: false, rejection_codes: [code], counts, document: null });
  if (result.status !== 0 || result.error || result.signal) return fail('R4_OUTER_PROCESS_FAILED');
  if (stderr.length) return fail('R4_OUTER_STDERR_UNEXPECTED');
  if (stdout.length > 262144) return fail('R4_OUTER_DOCUMENT_OVERSIZED');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(stdout); } catch { return fail('R4_OUTER_UTF8_INVALID'); }
  if (stdout.subarray(0,3).equals(Buffer.from([239,187,191])) || !text.endsWith('\n') || text.includes('\r')) return fail('R4_OUTER_FRAMING_INVALID');
  const frames = text.slice(0,-1).split('\n');
  const decoded = frames.map(line => {
    try {
      const value = JSON.parse(line);
      if (value?.schema === 'tecm.m40.collector.controls.v1') counts.final_documents++;
      else counts.additional_json_records++;
      return value;
    } catch { counts.unclassified_stdout_records++; return null; }
  });
  if (counts.final_documents > 1) return fail('R4_OUTER_DOCUMENT_DUPLICATE');
  if (frames.length !== 1) return fail(counts.unclassified_stdout_records ? 'R4_OUTER_UNCLASSIFIED_RECORD' : 'R4_OUTER_EXTRA_JSON_RECORD');
  if (!frames[0].startsWith('{') || !frames[0].endsWith('}') || decoded[0] === null) return fail('R4_OUTER_FRAMING_INVALID');
  const doc = decoded[0];
  if (doc.schema !== 'tecm.m40.collector.controls.v1') return fail('R4_OUTER_SCHEMA_INVALID');
  if (!exactSortedSet(Object.keys(doc), ['schema','correlation','result','controls','failure','cleanup'])) return fail('R4_OUTER_FIELDS_INVALID');
  if (!/^[a-f0-9]{64}$/.test(correlation) || doc.correlation !== correlation) return fail('R4_OUTER_CORRELATION_INVALID');
  const keyCount = v => v && typeof v === 'object' ? (Array.isArray(v) ? v.reduce((n,x) => n + keyCount(x),0)
    : Object.entries(v).reduce((n,[,x]) => n + 1 + keyCount(x),0)) : 0;
  if ([...text.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].length !== keyCount(doc)) return fail('R4_OUTER_FIELDS_INVALID');
  if (!['passed','failed'].includes(doc.result) || typeof doc.cleanup !== 'boolean' || !Array.isArray(doc.controls)
      || doc.controls.length > 10 || new Set(doc.controls.map(c => c.id)).size !== doc.controls.length) return fail('R4_OUTER_FIELDS_INVALID');
  for (const control of doc.controls) {
    if (!exactSortedSet(Object.keys(control), ['id','timed_out','deadline_at_ms','state_at_deadline','final_state','polls',
      'records','lifecycle','cleanup_codes','decision_cleanup','actual_removal','receive_error'])
        || !['partial','boundary','polling','streams','sticky','identical','duplicate','verbose','debug','progress'].includes(control.id)
        || !Array.isArray(control.records) || control.records.length > 512 || !Array.isArray(control.lifecycle)
        || !Array.isArray(control.cleanup_codes)) return fail('R4_OUTER_FIELDS_INVALID');
  }
  return { accepted: true, rejection_codes: [], counts, document: doc };
}

function runR4FramingControls(primary, correlation) {
  const script = `const fs=require('node:fs');const body=fs.readFileSync(0);const mode=process.argv[1];
    if(mode==='json')process.stdout.write('{"safe_adversary":true}\\n');
    if(mode==='plain')process.stdout.write('R4_SAFE_FRAME_CANARY\\n');
    process.stdout.write(body);
    if(mode==='second')process.stdout.write(body);
    if(mode==='suffix')process.stdout.write('R4_SAFE_FRAME_CANARY\\n');
    if(mode==='stderr')process.stderr.write('R4_SAFE_STDERR_CANARY\\n');`;
  const expected = { json: 'R4_OUTER_EXTRA_JSON_RECORD', plain: 'R4_OUTER_UNCLASSIFIED_RECORD',
    second: 'R4_OUTER_DOCUMENT_DUPLICATE', suffix: 'R4_OUTER_UNCLASSIFIED_RECORD', stderr: 'R4_OUTER_STDERR_UNEXPECTED' };
  return Object.entries(expected).map(([mode, code]) => {
    const result = spawnSync(process.execPath, ['-e',script,mode], { input: primary, windowsHide: true, timeout: 5000, maxBuffer: 524288 });
    saveR4AttemptEvidence(`H8-${mode}-primary`, { stdout: result.stdout, stderr: result.stderr, status: result.status,
      signal: result.signal, error: result.error ? String(result.error) : null });
    const inspected = inspectR4SyntheticProtocol(result, correlation);
    saveR4AttemptEvidence(`H8-${mode}-inspection`, inspected);
    if (inspected.accepted || !exactSortedSet(inspected.rejection_codes,[code])) throw new VerifierError('R4_H8_FAILED', 'Outer framing adversary did not reject exactly', {
      mode, expected: [code], observed: inspected.rejection_codes, counts: inspected.counts });
    return { id: 'H8-' + mode.toUpperCase(), passed: true, expected_rejection_codes: [code], observed_rejection_codes: inspected.rejection_codes, counts: inspected.counts };
  });
}

const requestedEvidenceRoot = process.env.TECM_M40_EVIDENCE_ROOT;
if (requestedEvidenceRoot && (!isAbsolute(requestedEvidenceRoot) || pathIsInside(repoRoot, requestedEvidenceRoot)
    || !statSync(requestedEvidenceRoot).isDirectory())) throw new Error('M40_EVIDENCE_ROOT_INVALID');
const r4AttemptEvidenceDirectory = requestedEvidenceRoot
  ? mkdtempSync(resolve(requestedEvidenceRoot, 'attempt-'))
  : process.argv.some(arg => ['--r4-controls','--r4-real-diagnostic'].includes(arg))
  ? mkdtempSync(resolve(tmpdir(), 'tecm-m40-r4-attempt-evidence-')) : null;
let databaseProbeNumber = 0;

function saveR4AttemptEvidence(name, value) {
  if (r4AttemptEvidenceDirectory) writeFileSync(resolve(r4AttemptEvidenceDirectory, `${name}.json`),
    JSON.stringify(value, (_key, item) => item === undefined ? null : item, 2) + '\n');
}

function requiredTracePhase(phase) {
  return r3PositivePhases.includes(phase) || r3NegativePhases.includes(phase);
}

function runR4SyntheticProcess(script) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'tecm-m40-r4-synthetic-'));
  const correlation = sha256(Buffer.from(randomUUID()));
  let parsed, result, protocol, cleanup = false;
  try {
    const scriptPath = resolve(temporary, 'synthetic.ps1');
    writeFileSync(scriptPath, script);
    result = spawnSync('pwsh', ['-NoLogo','-NoProfile','-NonInteractive','-File',scriptPath,
      '-Verifier',resolve(repoRoot,'scripts/testing/database-verify.ps1'),'-TemporaryRoot',temporary,'-Correlation',correlation],
    { cwd: repoRoot, windowsHide: true, timeout: 90000, maxBuffer: 262144 });
    if (r4AttemptEvidenceDirectory) {
      const primary = resolve(r4AttemptEvidenceDirectory, correlation);
      mkdirSync(primary);
      if (result.stdout != null) writeFileSync(resolve(primary, 'stdout.bin'), result.stdout);
      if (result.stderr != null) writeFileSync(resolve(primary, 'stderr.bin'), result.stderr);
      saveR4AttemptEvidence(`${correlation}-process`, { correlation, status: result.status, signal: result.signal,
        error: result.error ? { name: result.error.name, message: result.error.message, code: result.error.code } : null,
        stdout_acquired: result.stdout != null, stderr_acquired: result.stderr != null });
    }
    protocol = inspectR4SyntheticProtocol(result, correlation);
    // A failed child may still emit its single sanitized failure document.
    // Preserve that document for diagnosis, but never accept the failed exit.
    parsed = protocol.document ?? inspectR4SyntheticProtocol({ ...result, status: 0 }, correlation).document;
  } finally {
    try { rmSync(temporary, { recursive: true, force: false }); cleanup = !existsSync(temporary); }
    finally { saveR4AttemptEvidence(`${correlation}-inspection`, { correlation, parsed, protocol, cleanup }); }
  }
  if (!protocol.accepted) throw new VerifierError('R4_SYNTHETIC_PROTOCOL_FAILED', 'Synthetic protocol rejected', {
    rejection_codes: protocol.rejection_codes, counts: protocol.counts, sanitized_result: parsed, workspace_cleanup: cleanup ? 'PASS' : 'FAIL' });
  if (parsed.result !== 'passed' || !parsed.cleanup || !cleanup) throw new VerifierError('R4_SYNTHETIC_FAILED', 'Synthetic production job control failed', { result: parsed, cleanup });
  return { correlation, parsed, result, protocol, cleanup };
}

function runR4SyntheticControls() {
  const { correlation, parsed, result, protocol, cleanup } = runR4SyntheticProcess(r4SyntheticScript);
  const ids = ['partial','boundary','polling','streams','sticky','identical','duplicate','verbose','debug','progress'];
  if (!exactSortedSet(parsed.controls.map(c => c.id), ids)) throw new VerifierError('R4_CONTROL_INVENTORY_INVALID', 'Synthetic control inventory differed');
  const checked = new Map();
  for (const item of parsed.controls) {
    const packets = item.records.filter(r => r.packet);
    const names = packets.map(r => r.packet.phase);
    const expectedNames = ['partial','polling','sticky'].includes(item.id)
      ? ['session_setup_started','session_setup_completed','slow_setup_started']
      : item.id === 'boundary' ? ['session_setup_started','session_setup_completed']
      : item.id === 'identical' ? ['session_setup_started','session_setup_started']
      : item.id === 'duplicate' ? ['session_setup_started'] : [];
    const expectedTimeout = ['partial','boundary','sticky'].includes(item.id);
    const expectedError = item.id === 'duplicate' ? 'M40_JOB_PACKET_DUPLICATE_IDENTITY'
      : ['verbose','debug','progress'].includes(item.id) ? 'M40_JOB_STREAM_UNAUTHORIZED' : null;
    const lifecycleExpected = ['pre_stop_drain', ...(expectedTimeout || expectedError ? ['stop_started'] : []),'stop_terminal','post_stop_drain','removed'];
    const lifecycle = item.lifecycle.map(e => e.phase);
    const expectedCleanupCodes = item.id === 'sticky' ? ['M40_JOB_STOP_FAILED'] : expectedError ? ['M40_JOB_DRAIN_FAILED'] : [];
    const codes = [];
    if (item.receive_error) codes.push(item.receive_error);
    if (item.timed_out) codes.push('M40_COMPETITOR_JOB_TIMEOUT','M40_TRACE_PHASE_MISSING');
    if (packets.some(r => !r.timely)) codes.push('M40_JOB_TRACE_LATE');
    if (item.id === 'sticky' && item.cleanup_codes.length) codes.push('M40_JOB_CAPTURE_CLEANUP_FAILED');
    const expectedCodes = [...(expectedError ? [expectedError] : []),
      ...(expectedTimeout ? ['M40_COMPETITOR_JOB_TIMEOUT','M40_TRACE_PHASE_MISSING'] : []),
      ...(item.id === 'boundary' ? ['M40_JOB_TRACE_LATE'] : []), ...(item.id === 'sticky' ? ['M40_JOB_CAPTURE_CLEANUP_FAILED'] : [])];
    const identities = packets.map(r => `${r.correlation}|${r.packet.sequence}|${r.packet.stream}`);
    const streamNames = ['output','error','warning','information'];
    const streamCanaries = ['R4_OUTPUT_CANARY','R4_ERROR_CANARY','R4_WARNING_CANARY','R4_INFORMATION_CANARY'];
    const streamsValid = item.id !== 'streams' || (item.records.length === 4 && streamNames.every((stream,i) => {
      const records = item.records.filter(r => r.stream === stream);
      return records.length === 1 && records[0].digest === sha256(Buffer.from(streamCanaries[i]));
    }));
    const contentValid = item.id !== 'identical' || packets.length === 2 && packets.every((r,i) => r.packet.sequence === i+1
      && r.packet.digest === sha256(Buffer.from('R4_IDENTICAL_CANARY')) && r.packet.byte_count === Buffer.byteLength('R4_IDENTICAL_CANARY'));
    const timelyValid = item.id === 'boundary' ? packets[0]?.timely === true && packets[1]?.timely === false
      && packets[1].emitted_at_ms > item.deadline_at_ms : packets.every(r => r.timely);
    const authority = databaseFailureClassification({ status: 1, stdout: '[CLEANUP] database=PASS container=PASS\n', stderr: '',
      m40_job_capture: { accepted: codes.length === 0, rejection_codes: codes, evidence: item } }, cases.find(c => c.id === 'M40'));
    if (JSON.stringify(names) !== JSON.stringify(expectedNames) || JSON.stringify(lifecycle) !== JSON.stringify(lifecycleExpected)
        || item.timed_out !== expectedTimeout || item.receive_error !== expectedError || !exactSortedSet(codes,expectedCodes)
        || !exactSortedSet(item.cleanup_codes,expectedCleanupCodes) || !item.actual_removal || !streamsValid || !contentValid || !timelyValid
        || new Set(identities).size !== identities.length || item.records.some((r,i) => r.sequence !== i+1)
        || (item.id === 'polling' && item.polls < 3) || authority.caught || authority.exact_semantic_classification) {
      throw new VerifierError('R4_CONTROL_EXACT_SET_FAILED', 'Synthetic evidence did not meet its exact contract', {
        control: item.id, expected_codes: expectedCodes.sort(), observed_codes: codes.sort(), streams_valid: streamsValid,
        content_valid: contentValid, timely_valid: timelyValid, evidence: item });
    }
    checked.set(item.id, { id: item.id, passed: true, observed_rejection_codes: codes.sort(), expected_rejection_codes: expectedCodes.sort(),
      caught: false, record_count: item.records.length, polls: item.polls, evidence: item, actual_job_cleanup: 'PASS' });
    saveR4AttemptEvidence(`H-control-${item.id}`, checked.get(item.id));
  }
  const hControls = [['H1','polling'],['H2','identical'],['H3','duplicate'],['H4','streams'],['H5','partial'],['H6','boundary'],['H7','sticky']]
    .map(([id,name]) => ({ ...checked.get(name), id }));
  hControls.find(c => c.id === 'H4').unsupported_stream_controls = ['verbose','debug','progress'].map(name => checked.get(name));
  for (const control of hControls) saveR4AttemptEvidence(control.id, control);
  const framingControls = runR4FramingControls(result.stdout, correlation);
  hControls.push({ id: 'H8', passed: true, controls: framingControls });
  saveR4AttemptEvidence('H8', hControls.at(-1));
  return { passed: true, h1_h8: hControls, controls: ['partial','boundary','polling','streams','sticky'].map(name => checked.get(name)),
    outer_protocol: protocol.counts, source_restoration: repoRestorationEvidence().status, workspace_cleanup: cleanup ? 'PASS' : 'FAIL' };
}

function runM40SupervisoryStaticControls({ requireRepositoryWorkflow = true } = {}) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'tecm-m40-supervisory-ast-'));
  let result, ast, cleanup = false;
  const script = String.raw`
param([string]$Verifier)
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Verifier,[ref]$tokens,[ref]$errors)
function Hash-Source([string]$Text) {
  $normalized=$Text.Replace(([string][char]13+[char]10),[string][char]10)
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.UTF8Encoding]::new($false).GetBytes($normalized))).ToLowerInvariant()
}
$calls=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Wait-M40JobTerminal'},$true))
$observations=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'New-M40JobObservation'},$true))
$helpers=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Wait-M40JobTerminal','New-M40JobObservation')},$true))
$bounded=@($helpers | Where-Object {
  $p=@($_.Body.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -ceq 'TimeoutSeconds' })
  $p.Count -eq 1 -and $null -eq $p[0].DefaultValue -and $p[0].StaticType -eq [double] -and
    @($p[0].Attributes | Where-Object { $_.Extent.Text -ceq '[Parameter(Mandatory)]' }).Count -eq 1 -and
    @($p[0].Attributes | Where-Object { $_.Extent.Text -ceq '[ValidateRange(0.1,30)]' }).Count -eq 1
})
$envAccess=@($ast.FindAll({param($n)
  ($n -is [Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -like 'env:*') -or
  ($n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Member.Value -in @('GetEnvironmentVariable','SetEnvironmentVariable','GetEnvironmentVariables'))
},$true) | ForEach-Object { $_.Extent.Text } | Sort-Object)
$escapeExits=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Member.Value -in @('Exit','FailFast','SetShouldExit')},$true))
[ordered]@{
  parse_errors=$errors.Count
  wait_call_count=$calls.Count
  competitor_30_count=@($calls | Where-Object { $_.Extent.Text -ceq 'Wait-M40JobTerminal -Job $competitor -TimeoutSeconds 30 -Correlation $m40TraceCorrelation' }).Count
  holder_10_count=@($calls | Where-Object { $_.Extent.Text -ceq 'Wait-M40JobTerminal -Job $holder -TimeoutSeconds 10' }).Count
  observation_call_count=$observations.Count
  helper_forward_count=@($observations | Where-Object { $_.Extent.Text -ceq 'New-M40JobObservation -Job $Job -TimeoutSeconds $TimeoutSeconds -Correlation $Correlation' }).Count
  cleanup_10_count=@($observations | Where-Object { $_.Extent.Text -ceq 'New-M40JobObservation -Job $job -TimeoutSeconds 10' }).Count
  bounded_helper_count=$bounded.Count
  root_parameter_hash=Hash-Source $ast.ParamBlock.Extent.Text
  environment_access_hash=Hash-Source ($envAccess -join [string][char]10)
  alternative_exit_count=$escapeExits.Count
} | ConvertTo-Json -Compress
`;
  try {
    const path = resolve(temporary, 'guard.ps1');
    writeFileSync(path, script);
    result = spawnSync('pwsh', ['-NoLogo','-NoProfile','-NonInteractive','-File',path,
      '-Verifier',resolve(repoRoot,databaseVerifierPath)], { cwd: repoRoot, windowsHide: true, timeout: 30000, maxBuffer: 65536 });
    saveR4AttemptEvidence('S-static-primary', { stdout: result.stdout, stderr: result.stderr, status: result.status,
      signal: result.signal, error: result.error ? String(result.error) : null });
    try { ast = JSON.parse(result.stdout); } catch { ast = null; }
  } finally { rmSync(temporary, { recursive: true, force: false }); cleanup = !existsSync(temporary); }
  if (result.status !== 0 || result.error || result.signal || result.stderr.length || !ast || !cleanup) {
    throw new VerifierError('S_STATIC_AST_FAILED', 'Supervisory source inspection failed', { cleanup });
  }
  const s1 = ast.parse_errors === 0 && ast.wait_call_count === 2 && ast.competitor_30_count === 1
    && ast.holder_10_count === 1 && ast.observation_call_count === 2 && ast.helper_forward_count === 1
    && ast.cleanup_10_count === 1 && ast.bounded_helper_count === 2;
  if (!s1) throw new VerifierError('S1_PRODUCTION_BOUND_INVALID', 'Production supervision must use fixed bounded call sites', { ast });
  saveR4AttemptEvidence('S1', { id: 'S1', passed: true, supervisory_seconds: 30, holder_seconds: 10,
    expected_rejection_codes: [], observed_rejection_codes: [], ast });
  const terminal = inspectDatabaseVerifierTerminalAst();
  saveR4AttemptEvidence('S2-terminal-primary', terminal);
  let workflow = '', workflowReadError = null;
  try { workflow = readFileSync(resolve(repoRoot,'.github/workflows/release-validation.yml'),'utf8').replace(/\r\n/g,'\n'); }
  catch (error) { workflowReadError = error.code ?? 'WORKFLOW_READ_FAILED'; }
  // Pin the explicit opt-in M40 scope; all existing timeout parameters remain unchanged.
  const s2 = ast.root_parameter_hash === '6ec13bee63f4a3ae7028bbe82d3f50aa394544c5e4daccbff2ddd7975bc8abbc'
    && ast.environment_access_hash === '2d7e2f0f48e82f5d56d0740ab8d0fd41f4a6b7f5bae3219f870895f8eb2ec1dc'
    && ast.alternative_exit_count === 0 && terminal.accepted && terminal.process.stderr_empty;
  // C-class release integration checks the invocation, independently of image provisioning.
  let repositoryWorkflow;
  try {
    repositoryWorkflow = repositoryWorkflowIsValid(workflow);
  } catch (error) {
    if (error.code !== 'S2_YAML_PARSER_UNAVAILABLE') throw error;
    throw new VerifierError('S2_YAML_PARSER_UNAVAILABLE', 'Run npm --prefix admin-web ci');
  }
  if (!s2 || (requireRepositoryWorkflow && !repositoryWorkflow)) throw new VerifierError('S2_RELEASE_ESCAPE_HATCH', 'Verifier supervision contract or required release invocation changed', {
    ast, terminal_accepted: terminal.accepted });
  const controls = [{ id: 'S1', passed: true, supervisory_seconds: 30, holder_seconds: 10,
    expected_rejection_codes: [], observed_rejection_codes: [], ast },
  { id: 'S2', passed: true, root_parameters_match_declared_scope: true, environment_access_unchanged: true,
    complete_release_invocation_without_arguments: repositoryWorkflow,
    repository_workflow: { result: repositoryWorkflow ? 'PASS' : 'FAIL', gates_m40: requireRepositoryWorkflow,
      read_error: workflowReadError },
    terminal_ast: terminal, workspace_cleanup: 'PASS',
    expected_rejection_codes: [], observed_rejection_codes: [] }];
  saveR4AttemptEvidence('S2', controls[1]);
  return controls;
}

function m40SupervisorySyntheticScript() {
  // Reuse the exact production-helper fixture and strict outer protocol. Only
  // these disposable child bodies change; H1-H8 retain their original fixture.
  let script = r4SyntheticScript;
  const splice = (target, replacement) => { script = replaceSourceExactly(script, target, replacement); };
  splice("foreach ($mode in @('partial','boundary','polling','streams','sticky','identical','duplicate','verbose','debug','progress'))",
    "foreach ($mode in @('partial','boundary','polling'))");
  splice("      if ($Mode -in @('partial','boundary','polling','sticky','duplicate')) {",
    "      $context.ChildState='Running'\n      Write-M40WorkerPacket $context 'process' 'phase_unknown' -Classification 'child_started'\n      if ($Mode -in @('partial','boundary','polling','sticky','duplicate')) {");
  splice("        Write-M40WorkerPacket $context 'phase' 'slow_setup_started'\n      } elseif ($Mode -eq 'streams') {",
    "        Write-M40WorkerPacket $context 'phase' 'slow_setup_started'\n        $context.ChildState='Exited'; $context.ChildExitCode=0\n        Write-M40WorkerPacket $context 'process' 'phase_unknown' -Classification 'child_exited'\n      } elseif ($Mode -eq 'streams') {");
  splice("        [IO.File]::WriteAllText($Release+'.ack','emitted')\n        Start-Sleep -Seconds 30",
    "        $context.ChildState='Exited'; $context.ChildExitCode=0\n        Write-M40WorkerPacket $context 'process' 'phase_unknown' -Classification 'child_exited'\n        [IO.File]::WriteAllText($Release+'.ack','emitted')");
  splice("      if (-not [IO.File]::Exists($release+'.ack')) { throw 'R4_BOUNDARY_LATE_EMISSION_MISSING' }",
    "      if (-not [IO.File]::Exists($release+'.ack')) { throw 'R4_BOUNDARY_LATE_EMISSION_MISSING' }\n      $completion=[Diagnostics.Stopwatch]::StartNew()\n      while ($job.State -ne 'Completed' -and $completion.Elapsed.TotalSeconds -lt 3) { Start-Sleep -Milliseconds 10 }\n      if ($job.State -ne 'Completed') { throw 'R4_BOUNDARY_COMPLETION_MISSING' }");
  return script;
}

function runM40SupervisorySyntheticControls() {
  const { parsed, protocol, cleanup } = runR4SyntheticProcess(m40SupervisorySyntheticScript());
  if (!exactSortedSet(parsed.controls.map(c => c.id), ['partial','polling','boundary'])) {
    throw new VerifierError('S_CONTROL_INVENTORY_INVALID', 'Supervisory control inventory differed');
  }
  const checked = new Map();
  for (const item of parsed.controls) {
    const packets = item.records.filter(r => r.packet), phases = packets.filter(r => r.packet.kind === 'phase');
    const process = packets.filter(r => r.packet.kind === 'process');
    const timeout = item.id !== 'polling', late = item.id === 'boundary';
    const expectedPhases = ['session_setup_started','session_setup_completed', ...(late ? [] : ['slow_setup_started'])];
    const expectedCodes = [...(timeout ? ['M40_COMPETITOR_JOB_TIMEOUT','M40_TRACE_PHASE_MISSING'] : []),
      ...(late ? ['M40_JOB_TRACE_LATE'] : [])].sort();
    const codes = [...(item.timed_out ? ['M40_COMPETITOR_JOB_TIMEOUT','M40_TRACE_PHASE_MISSING'] : []),
      ...(packets.some(r => !r.timely) ? ['M40_JOB_TRACE_LATE'] : [])].sort();
    const lifecycle = ['pre_stop_drain', ...(item.id === 'partial' ? ['stop_started'] : []),'stop_terminal','post_stop_drain','removed'];
    const identities = packets.map(r => `${r.correlation}|${r.packet.sequence}|${r.packet.stream}`);
    const started = process[0]?.packet, finished = process[1]?.packet;
    const authority = databaseFailureClassification({ status: 1, stdout: '[CLEANUP] database=PASS container=PASS\n', stderr: '',
      m40_job_capture: { accepted: codes.length === 0, rejection_codes: codes, evidence: item } }, cases.find(c => c.id === 'M40'));
    const completionValid = item.id === 'partial' ? process.length === 1 && item.final_state === 'Stopped'
      : process.length === 2 && item.final_state === 'Completed' && finished.classification === 'child_exited'
        && finished.child_state === 'Exited' && finished.child_exit_code === 0
        && (late ? finished.observed_at_ms > item.deadline_at_ms && !process[1].timely
          : finished.observed_at_ms <= item.deadline_at_ms && process[1].timely);
    if (item.timed_out !== timeout || (timeout && item.state_at_deadline !== 'Running') || item.receive_error !== null
        || JSON.stringify(phases.map(r => r.packet.phase)) !== JSON.stringify(expectedPhases)
        || JSON.stringify(item.lifecycle.map(e => e.phase)) !== JSON.stringify(lifecycle)
        || !exactSortedSet(codes,expectedCodes) || !item.actual_removal || item.cleanup_codes.length
        || item.decision_cleanup.JobsRemoved !== 'PASS' || item.decision_cleanup.JobsStopped === 'FAIL'
        || started?.classification !== 'child_started' || started.child_state !== 'Running' || !process[0].timely
        || !completionValid || authority.caught || authority.exact_semantic_classification
        || new Set(identities).size !== identities.length || packets.length !== item.records.length
        || (late ? phases[0]?.timely !== true || phases[1]?.timely !== false : packets.some(r => !r.timely))) {
      throw new VerifierError('S_SYNTHETIC_EXACT_SET_FAILED', 'Supervisory evidence failed its fixed outcome', {
        control: item.id, expected_rejection_codes: expectedCodes, observed_rejection_codes: codes, completion_valid: completionValid, evidence: item });
    }
    checked.set(item.id, { id: item.id, passed: true, caught: false, semantic_authority: false,
      expected_rejection_codes: expectedCodes, observed_rejection_codes: codes, evidence: item, actual_job_cleanup: 'PASS' });
    saveR4AttemptEvidence(`S-control-${item.id}`, checked.get(item.id));
    if (item.id === 'partial') saveR4AttemptEvidence('S3', { ...checked.get('partial'), id: 'S3', synthetic_deadline_seconds: 0.5,
      outer_protocol: protocol.counts, workspace_cleanup: cleanup ? 'PASS' : 'FAIL' });
  }
  const controls = [{ ...checked.get('partial'), id: 'S3', synthetic_deadline_seconds: 0.5,
    outer_protocol: protocol.counts, workspace_cleanup: cleanup ? 'PASS' : 'FAIL' },
  { id: 'S4', passed: true, before_deadline: checked.get('polling'), after_deadline: checked.get('boundary'),
    fixed_outcomes: true, workspace_cleanup: cleanup ? 'PASS' : 'FAIL' }];
  saveR4AttemptEvidence('S4', controls[1]);
  return controls;
}

function r3SqlNotice(phase) {
  const state = ['rpc_finished', 'classification_completed'].includes(phase) ? 'caught_sqlstate' : 'null::text';
  return `raise notice '@@TECM_R3_PHASE@@${phase}|%|%', trunc(extract(epoch from clock_timestamp()) * 1000, 3), coalesce(${state}, 'none');`;
}

function instrumentM40TraceSql(bytes, mode) {
  let candidate = Buffer.from(bytes);
  const inject = (target, replacement) => {
    candidate = mutateBytes(candidate, { id: 'R3-TRACE-CONSTRUCTION', search: target, replacement, sqlSource: true }).bytes;
  };
  const timeoutAssertion = expected => `if current_setting('statement_timeout') <> '${expected}' then raise exception 'R3_TIMEOUT_STATE_INVALID'; end if;`;
  const standalone = phase => {
    const assertion = phase === 'statement_timeout_armed' ? timeoutAssertion('3s')
      : mode !== 'pre-rpc' && ['slow_setup_started', 'slow_setup_completed'].includes(phase) ? timeoutAssertion('0') : '';
    return `do $tecm_r3$ begin ${assertion} ${r3SqlNotice(phase)} end $tecm_r3$;`;
  };
  inject('set role authenticated;', `${standalone('session_setup_started')}\nset role authenticated;`);
  const sessionEnd = "select set_config('app.test_request_id', :'request_id', false);";
  inject(sessionEnd, `${sessionEnd}\n${standalone('session_setup_completed')}`);
  if (mode === 'pre-rpc') {
    inject('select pg_sleep(5);', `${standalone('statement_timeout_armed')}\n${standalone('slow_setup_started')}\nselect pg_sleep(5);`);
  } else {
    inject('select pg_sleep(3.25);', `${standalone('slow_setup_started')}\nselect pg_sleep(3.25);\n${standalone('slow_setup_completed')}`);
    const rpcNotice = "    raise notice '@@TECM_M40_PHASE@@rpc_invoked';";
    inject(rpcNotice, `    ${timeoutAssertion('3s')}\n    ${r3SqlNotice('statement_timeout_armed')}\n    ${r3SqlNotice('rpc_started')}\n${rpcNotice}`);
    const end = 'end\n$$;\n\nreset statement_timeout;';
    inject(end, `  ${r3SqlNotice('rpc_finished')}\n  ${r3SqlNotice('classification_completed')}\n${end}`);
    if (mode === 'unknown') {
      const after = standalone('slow_setup_completed');
      inject(after, `${after}\n\\echo @@TECM_R3_STREAM_PHASE@@slow_setup_completed\n\\echo ERROR: R3_STDOUT_CANARY\n\\warn ERROR: R3_STDERR_CANARY`);
    }
  }
  if (candidate.equals(bytes)) throw new VerifierError('SOURCE_REPLACEMENT_INVALID', 'Trace construction did not change its disposable input');
  return candidate;
}

function runR3ConstructionControls() {
  const controls = [];
  const replacement = "do $$ begin perform 1; end $$; -- $& $' $` $$ $1 $12 $99\n";
  for (const [name, start, end, fn] of [
    ['batch1-release-blockers-mutation-verify.mjs', 'function replaceBatch1SourceExactly(', 'function prepareMutationBytes(', 'replaceBatch1SourceExactly'],
    ['validate-release-workflow.mjs', 'function replaceExactly(', 'function matchPatternExactly(', 'replaceExactly']
  ]) {
    const source = readFileSync(resolve(repoRoot, 'scripts/testing', name), 'utf8');
    const begin = source.indexOf(start), finish = source.indexOf(end, begin);
    if (begin < 0 || finish < begin) throw new VerifierError('R3_A_HELPER_MISSING', 'Authorized construction helper is missing');
    const helper = source.slice(begin, finish);
    const context = { count: countOccurrences, recordMutationProof: () => {}, replacement };
    const candidate = runInNewContext(`${helper}\n${fn}('prefix TARGET suffix', 'TARGET', replacement)`, context, { timeout: 1000 });
    if (candidate !== 'prefix ' + replacement + ' suffix') throw new VerifierError('R3_A_FAILED', 'Authorized helper interpreted replacement tokens');
    controls.push({ id: `R3-A-${name}`, passed: true, replacement_delta: 1 });
  }
  const guardSource = readFileSync(resolve(repoRoot, 'scripts/testing/validate-release-workflow.mjs'), 'utf8');
  const patternHelpers = guardSource.slice(guardSource.indexOf('function matchPatternExactly('), guardSource.indexOf('function insertBeforeBatch1Setup('));
  const patternCandidate = runInNewContext(`${patternHelpers}\nreplacePatternExactly('prefix TARGET suffix', /TARGET/, replacement)`,
    { recordMutationProof: () => {}, replacement }, { timeout: 1000 });
  if (patternCandidate !== 'prefix ' + replacement + ' suffix') throw new VerifierError('R3_A_FAILED', 'Pattern construction interpreted replacement tokens');
  controls.push({ id: 'R3-A-PATTERN-SPLICE', passed: true, replacement_delta: 1 });
  for (const eol of ['LF', 'CRLF']) for (const bom of [false, true]) {
    const original = encodeText('select 1;\n-- target\nselect 2;\n', { hasBom: bom, eol });
    const candidate = mutateBytes(original, { id: 'R3-A', search: '-- target\n', replacement, sqlSource: true });
    const expected = encodeText('select 1;\n' + replacement + 'select 2;\n', { hasBom: bom, eol });
    if (!candidate.bytes.equals(expected) || candidate.matches !== 1) throw new VerifierError('R3_A_FAILED', 'Literal construction failed');
    const root = mkdtempSync(resolve(tmpdir(), 'tecm-r3-construction-'));
    let restored = false;
    try {
      const path = resolve(root, 'candidate.sql');
      writeFileSync(path, original); writeFileSync(path, candidate.bytes); writeFileSync(path, original);
      restored = readFileSync(path).equals(original);
    } finally { rmSync(root, { recursive: true, force: true }); }
    if (!restored || existsSync(root)) throw new VerifierError('R3_A_RESTORATION_FAILED', 'Construction cleanup failed');
    controls.push({ id: `R3-A-${eol}-${bom}`, passed: true, replacement_delta: 1, restoration: 'PASS', cleanup: 'PASS' });
  }
  const mixed = Buffer.from('prefix\r\n-- target\nsuffix\r\n');
  const preserved = mutateBytes(mixed, { id: 'R3-A-MIXED-PRESERVATION', search: '-- target\n', replacement });
  if (!preserved.bytes.equals(Buffer.from('prefix\r\n' + replacement + 'suffix\r\n'))
      || preserved.eol !== 'MIXED_PRESERVED') throw new VerifierError('R3_A_FAILED', 'Untouched source representation changed');
  controls.push({ id: 'R3-A-MIXED-PRESERVATION', passed: true, unchanged_prefix_suffix_bytes: true });
  const source = '-- target\n';
  const broken = source.replace('-- target\n', 'do $$ begin null; end $$;\n'); // Deliberate R3-E legacy negative fixture.
  let executions = 0;
  for (const [id, input, spec, expected] of [
    ['zero', 'select 1;\n', { search: '-- target\n', replacement }, 'MATCH_COUNT'],
    ['multiple', source + source, { search: '-- target\n', replacement }, 'MATCH_COUNT'],
    ['malformed', source, { search: '-- target\n', replacement: broken, sqlSource: true }, 'SQL_DOLLAR_QUOTE_INVALID']
  ]) {
    let observed = null;
    try { mutateBytes(Buffer.from(input), { id, ...spec }); executions++; } catch (error) { observed = error.code; }
    if (observed !== expected || executions !== 0) throw new VerifierError('R3_E_FAILED', 'Invalid construction reached execution');
    controls.push({ id: `R3-E-${id}`, passed: true, rejection_codes: [observed], child_executions: executions });
  }
  return controls;
}

function runR3TraceTamperControls(primary, context) {
  const original = JSON.parse(Buffer.from(context.bytes).toString('utf8'));
  const encode = value => Buffer.from(JSON.stringify(value) + '\n');
  const controls = [];
  for (const offset of [-600000, 600000]) {
    const shifted = structuredClone(original);
    shifted.events.forEach(e => { if (e.sql_at_ms !== null) e.sql_at_ms += offset; });
    const observed = inspectM40Trace({ ...context, bytes: encode(shifted) });
    if (!observed.accepted || observed.slow_duration_ms !== primary.slow_duration_ms) throw new VerifierError('M40_CLOCK_DOMAIN_CONTROL_FAILED', 'SQL clock offset changed local freshness or SQL duration');
    controls.push({ id: `M40-SQL-CLOCK-OFFSET-${offset}`, passed: true, slow_duration_ms: observed.slow_duration_ms });
  }
  const cases = [
    ['rpc-source-without-sql-time', t => { for (const e of t.events) if (['statement_timeout_armed','rpc_started','rpc_finished'].includes(e.phase)) { e.source = 'verifier'; e.sql_at_ms = null; } }, 'M40_TRACE_PHASE_UNAUTHORIZED'],
    ['rpc-stream-relabeled', t => { t.events.find(e => e.phase === 'rpc_started').stream = 'stdout'; }, 'M40_TRACE_PHASE_UNAUTHORIZED'],
    ['rpc-time-nonfinite', t => { t.events.find(e => e.phase === 'rpc_started').sql_at_ms = Infinity; }, 'M40_TRACE_SQL_TIME_INVALID'],
    ['sql-time-missing', t => { t.events[2].sql_at_ms = null; }, 'M40_TRACE_SQL_TIME_INVALID'],
    ['sql-time-reversed', t => { t.events[3].sql_at_ms = t.events[2].sql_at_ms - 1; }, 'M40_TRACE_SQL_TIME_INVALID'],
    ['host-future', t => { t.events[2].at_ms = t.completed_at_ms + 1; }, 'M40_TRACE_TIME_INVALID'],
    ['schema', t => { t.schema = 'tecm.m40.diagnostic.v2'; }, 'M40_TRACE_SCHEMA_INVALID'],
    ['correlation', t => { t.correlation = 'f'.repeat(64); }, 'M40_TRACE_CORRELATION_INVALID'],
    ['missing', t => { t.events.splice(t.events.findIndex(e => e.phase === 'slow_setup_started'), 1); }, 'M40_TRACE_PHASE_MISSING'],
    ['duplicate', t => { t.events.splice(5, 0, structuredClone(t.events[4])); }, 'M40_TRACE_PHASE_DUPLICATE'],
    ['reorder', t => { [t.events[2].phase, t.events[3].phase] = [t.events[3].phase, t.events[2].phase]; }, 'M40_TRACE_PHASE_ORDER_INVALID'],
    ['completion-without-start', t => { t.events.splice(t.events.findIndex(e => e.phase === 'slow_setup_started'), 1); }, 'M40_TRACE_PHASE_MISSING'],
    ['early-timeout', t => { [t.events[5].phase, t.events[6].phase] = [t.events[6].phase, t.events[5].phase]; }, 'M40_TRACE_PHASE_ORDER_INVALID'],
    ['early-rpc', t => { [t.events[6].phase, t.events[7].phase] = [t.events[7].phase, t.events[6].phase]; }, 'M40_TRACE_PHASE_ORDER_INVALID'],
    ['constant-elapsed', t => { t.events[5].elapsed_ms = 3250; }, 'M40_TRACE_ELAPSED_INVALID'],
    ['fabricated-elapsed', t => { t.events[5].elapsed_ms += 1000; }, 'M40_TRACE_ELAPSED_INVALID'],
    ['field', t => { t.events[0].extra = true; }, 'M40_TRACE_FIELDS_INVALID'],
    ['record', t => { const e = structuredClone(t.events.at(-1)); e.phase = 'phase_unknown'; t.events.push(e); }, 'M40_TRACE_RECORD_UNEXPECTED'],
    ['cleanup', t => { t.events.at(-1).classification = 'cleanup_failed'; }, 'M40_TRACE_CLEANUP_FAILED']
  ];
  for (const [id, transform, expected] of cases) {
    const value = structuredClone(original); transform(value);
    value.events.forEach((e, i) => { e.sequence = i + 1; });
    const observed = inspectM40Trace({ ...context, bytes: encode(value) });
    if (!exactSortedSet(observed.rejection_codes, [expected])) throw new VerifierError('R3_G_FAILED', 'Trace tamper rejection mismatch', { id, expected: [expected], observed: observed.rejection_codes });
    controls.push({ id: `R3-G-${id}`, passed: true, rejection_codes: observed.rejection_codes });
  }
  for (const [id, overrides, expected] of [
    ['stale', { mtimeMs: context.startedAt - 1 }, 'M40_TRACE_STALE'],
    ['late', { mtimeMs: context.finishedAt + 1 }, 'M40_TRACE_LATE'],
    ['oversized', { bytes: Buffer.alloc(65537, 32) }, 'M40_TRACE_OVERSIZED'],
    ['utf8', { bytes: Buffer.from([0xc3, 0x28, 10]) }, 'M40_TRACE_UTF8_INVALID'],
    ['json', { bytes: Buffer.from('{\n') }, 'M40_TRACE_JSON_INVALID'],
    ['newline', { bytes: Buffer.from('{}\r\n') }, 'M40_TRACE_NEWLINE_INVALID'],
    ['missing-file', { present: false }, 'M40_TRACE_MISSING'],
    ['cleanup-artifact', { cleanup: 'FAIL' }, 'M40_TRACE_CLEANUP_FAILED']
  ]) {
    const observed = inspectM40Trace({ ...context, ...overrides });
    if (!exactSortedSet(observed.rejection_codes, [expected])) throw new VerifierError('R3_G_FAILED', 'Trace artifact rejection mismatch', { id, expected: [expected], observed: observed.rejection_codes });
    controls.push({ id: `R3-G-${id}`, passed: true, rejection_codes: observed.rejection_codes });
  }
  if (!primary.accepted) throw new VerifierError('R3_G_BASELINE_FAILED', 'Tampering requires a valid primary trace');
  return controls;
}


function mutateBytes(originalBytes, mutation) {
  const shape = textShape(originalBytes);
  try { new TextDecoder('utf-8', { fatal: true }).decode(originalBytes); } catch { throw new VerifierError('SOURCE_ENCODING_INVALID', 'Source is not strict UTF-8'); }
  if (/\r(?!\n)/.test(shape.text) || mutation.search.includes('\r') || mutation.replacement.includes('\r')) {
    throw new VerifierError('SOURCE_EOL_INVALID', 'Source construction requires canonical target and replacement text', {
      input_bytes: originalBytes.length, crlf_count: shape.crlfCount, bare_lf_count: shape.lfCount });
  }
  const normalized = shape.text.replace(/\r\n/g, '\n');
  const matches = countOccurrences(normalized, mutation.search);
  if (matches !== 1) {
    throw new VerifierError(
      'MATCH_COUNT',
      `${mutation.id} mutation matched ${matches} times`,
      { mutation: mutation.id, matches }
    );
  }
  const mutated = replaceSourceExactly(normalized, mutation.search, mutation.replacement);
  if (mutation.sqlSource || mutation.file?.endsWith('.sql')) assertSqlDollarQuotes(mutated);
  // Match canonically, then splice the original representation. In particular,
  // an existing mixed-EOL SQL checkout is never silently normalized. Each
  // inserted newline follows the corresponding target line's own ending.
  const logicalStart = normalized.indexOf(mutation.search);
  const offsets = [0];
  for (let raw = 0; raw < shape.text.length;) {
    raw += shape.text.startsWith('\r\n', raw) ? 2 : 1;
    offsets.push(raw);
  }
  const start = offsets[logicalStart], end = offsets[logicalStart + mutation.search.length];
  const rawTarget = shape.text.slice(start, end);
  const targetEndings = rawTarget.match(/\r\n|\n/g) ?? [];
  const neighboringEnding = shape.text.slice(start).match(/\r\n|\n/)?.[0] ?? '\n';
  let endingIndex = 0;
  const replacement = mutation.replacement.replace(/\n/g, () =>
    targetEndings[Math.min(endingIndex++, targetEndings.length - 1)] ?? neighboringEnding);
  const candidateText = shape.text.slice(0, start) + replacement + shape.text.slice(end);
  const payload = Buffer.from(candidateText, 'utf8');
  const candidateBytes = shape.hasBom ? Buffer.concat([originalBytes.subarray(0, 3), payload]) : payload;
  if (candidateBytes.equals(originalBytes) || candidateText.replace(/\r\n/g, '\n') !== mutated
      || !candidateText.startsWith(shape.text.slice(0, start)) || !candidateText.endsWith(shape.text.slice(end))) {
    throw new VerifierError('SOURCE_REPLACEMENT_INVALID', 'Exact representation-preserving splice failed');
  }
  return {
    bytes: candidateBytes,
    matches,
    eol: shape.crlfCount > 0 && shape.lfCount > 0 ? 'MIXED_PRESERVED' : shape.eol,
    utf8_bom: shape.hasBom,
    replacement_delta: 1,
    unchanged_prefix_suffix_bytes: true
  };
}

function runTest(root, testNamePattern, { raw = false } = {}) {
  const args = ['--experimental-strip-types', '--test'];
  if (testNamePattern) args.push('--test-name-pattern', testNamePattern);
  args.push(resolve(root, testPath));
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: raw ? undefined : 'utf8',
    env: process.env,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
}

function databaseProbeEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment[m40SidecarPathEnvironment];
  delete environment[m40SidecarCorrelationEnvironment];
  delete environment.TECM_M40_TRACE_PATH;
  delete environment.TECM_M40_TRACE_CORRELATION;
  return { ...environment, ...overrides };
}

function spawnDatabaseProbe(root, environment) {
  const probe = ++databaseProbeNumber;
  const args = [
    '-NoLogo', '-NoProfile', '-File', resolve(root, 'scripts/testing/database-verify.ps1')
  ];
  if (m40AcceptanceMode) args.push('-M40Acceptance');
  saveR4AttemptEvidence(`probe-${probe}-start`, { command: ['pwsh', ...args], cwd: root,
    semantic_correlation: environment[m40SidecarCorrelationEnvironment] ?? null,
    trace_correlation: environment.TECM_M40_TRACE_CORRELATION ?? null,
    started_at: new Date().toISOString(), source_hashes: Object.fromEntries(sourceFiles.map(file =>
      [file, sha256(readFileSync(resolve(root, file)))])) });
  if (r4AttemptEvidenceDirectory) {
    const directory = resolve(r4AttemptEvidenceDirectory, 'probe-' + probe + '-inputs');
    mkdirSync(directory);
    for (const file of [databaseVerifierPath, ...sourceFiles.filter(f => f.startsWith('supabase/'))]) {
      writeFileSync(resolve(directory, file.replaceAll('/', '__')), readFileSync(resolve(root,file)), { flag: 'wx' });
    }
  }
  const result = spawnSync('pwsh', args, {
    cwd: root,
    env: environment,
    timeout: databaseProbeTimeoutMilliseconds,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (r4AttemptEvidenceDirectory) {
    for (const stream of ['stdout', 'stderr']) {
      if (Buffer.isBuffer(result[stream])) writeFileSync(resolve(r4AttemptEvidenceDirectory,
        `probe-${probe}-${stream}.bin`), result[stream], { flag: 'wx' });
    }
    saveR4AttemptEvidence(`probe-${probe}-exit`, { status: result.status, signal: result.signal,
      error: result.error ? String(result.error) : null, finished_at: new Date().toISOString() });
  }
  return { ...result, stdout: result.stdout?.toString('utf8'), stderr: result.stderr?.toString('utf8') };
}

function pathIsInside(parent, candidate) {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function inspectM40Sidecar({
  path,
  expectedCorrelation,
  preexisting,
  startedAt,
  finishedAt,
  cleanup = 'UNKNOWN'
}) {
  const validationCodes = new Set();
  const records = [];
  const malformed = [];
  let occurrenceCount = 0;
  let present = false;
  let sizeBytes = null;
  let stale = false;
  let late = false;

  if (preexisting) validationCodes.add('M40_SIDECAR_PREEXISTING');
  if (!existsSync(path)) {
    validationCodes.add('M40_SIDECAR_MISSING');
    return {
      records,
      malformed,
      validation_codes: [...validationCodes].sort(),
      signatures: [],
      occurrence_count: occurrenceCount,
      present,
      preexisting,
      size_bytes: sizeBytes,
      stale,
      late,
      cleanup
    };
  }

  present = true;
  let bytes;
  let stats;
  try {
    stats = statSync(path);
    if (!stats.isFile()) {
      validationCodes.add('M40_SIDECAR_NOT_FILE');
      return {
        records,
        malformed,
        validation_codes: [...validationCodes].sort(),
        signatures: [],
        occurrence_count: occurrenceCount,
        present,
        preexisting,
        size_bytes: sizeBytes,
        stale,
        late,
        cleanup
      };
    }
    bytes = readFileSync(path);
    sizeBytes = bytes.length;
  } catch {
    validationCodes.add('M40_SIDECAR_READ_FAILED');
    return {
      records,
      malformed,
      validation_codes: [...validationCodes].sort(),
      signatures: [],
      occurrence_count: occurrenceCount,
      present,
      preexisting,
      size_bytes: sizeBytes,
      stale,
      late,
      cleanup
    };
  }

  stale = stats.mtimeMs < startedAt;
  late = stats.mtimeMs > finishedAt;
  if (stale) validationCodes.add('M40_SIDECAR_STALE');
  if (late) validationCodes.add('M40_SIDECAR_LATE');
  if (bytes.length === 0) {
    validationCodes.add('M40_SIDECAR_EMPTY');
  } else if (bytes.length > m40SidecarMaximumBytes) {
    validationCodes.add('M40_SIDECAR_OVERSIZED');
  } else {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      validationCodes.add('M40_SIDECAR_ENCODING_INVALID');
    }
    if (text !== undefined) {
      const candidates = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      occurrenceCount = candidates.length;
      if (occurrenceCount !== 1) validationCodes.add('M40_SIDECAR_RECORD_COUNT_INVALID');
      for (const candidate of candidates) {
        try {
          const record = parseM40Json(candidate);
          const recordValidationCodes = m40SemanticRecordValidationCodes(record, expectedCorrelation);
          if (recordValidationCodes.length > 0) {
            malformed.push('invalid_schema');
            for (const code of recordValidationCodes) validationCodes.add(code);
          } else {
            records.push(record);
          }
        } catch {
          malformed.push('invalid_json');
          validationCodes.add('M40_SIDECAR_JSON_INVALID');
        }
      }
    }
  }

  return {
    records,
    malformed,
    validation_codes: [...validationCodes].sort(),
    signatures: records.map(semanticSignature).sort(),
    occurrence_count: occurrenceCount,
    present,
    preexisting,
    size_bytes: sizeBytes,
    stale,
    late,
    cleanup
  };
}

function runDatabaseProbe(root = repoRoot, { m40Sidecar = false, traceMode = null } = {}) {
  if (!m40Sidecar) return spawnDatabaseProbe(root, databaseProbeEnvironment());

  const sidecarRoot = mkdtempSync(resolve(tmpdir(), 'tecm-m40-sidecar-'));
  const sidecarPath = resolve(sidecarRoot, 'semantic-record.json');
  const correlation = randomUUID();
  const traceCorrelation = sha256(Buffer.from(randomUUID()));
  const tracePath = resolve(sidecarRoot, 'diagnostic.json');
  let traceObservation = null;
  let jobCapture = null;
  let jobContext = null;
  const jobPath = resolve(sidecarRoot, 'job-capture.json');
  if (existsSync(jobPath)) throw new VerifierError('M40_JOB_CAPTURE_PREEXISTING', 'Job capture must not preexist');
  let traceContext = null;
  if (existsSync(tracePath)) throw new VerifierError('M40_TRACE_SETUP_INVALID', 'Diagnostic trace must not preexist');
  if (pathIsInside(repoRoot, sidecarRoot) || existsSync(sidecarPath)) {
    rmSync(sidecarRoot, { recursive: true, force: true });
    throw new VerifierError('M40_SIDECAR_SETUP_FAILED', 'M40 sidecar must begin outside the repository at a nonexistent path');
  }

  const startedAt = Date.now();
  const preexisting = existsSync(sidecarPath);
  let result;
  let observation;
  let cleanup = 'FAIL';
  try {
    result = spawnDatabaseProbe(root, databaseProbeEnvironment({
      [m40SidecarPathEnvironment]: sidecarPath,
      [m40SidecarCorrelationEnvironment]: correlation,
      ...(traceMode ? { TECM_M40_TRACE_PATH: tracePath, TECM_M40_TRACE_CORRELATION: traceCorrelation } : {})
    }));
    const finishedAt = Date.now();
    observation = inspectM40Sidecar({
      path: sidecarPath,
      expectedCorrelation: correlation,
      preexisting,
      startedAt,
      finishedAt
    });
    observation.expected_correlation = correlation;
    if (traceMode) {
      const present = existsSync(tracePath);
      const info = present ? statSync(tracePath) : null;
      traceContext = { correlation: traceCorrelation, startedAt, finishedAt,
        mtimeMs: info?.mtimeMs ?? finishedAt, mode: traceMode, present,
        bytes: present && info.size <= m40TraceMaximumBytes ? readFileSync(tracePath) : Buffer.alloc(present ? m40TraceMaximumBytes + 1 : 0) };
      traceObservation = inspectM40Trace(traceContext);
      const jobPresent = existsSync(jobPath), jobInfo = jobPresent ? statSync(jobPath) : null;
      jobContext = { correlation: traceCorrelation, startedAt, finishedAt, present: jobPresent,
        mtimeMs: jobInfo?.mtimeMs ?? finishedAt,
        bytes: jobPresent && jobInfo.size <= 131072 ? readFileSync(jobPath) : Buffer.alloc(jobPresent ? 131073 : 0) };
      jobCapture = inspectM40JobCapture(jobContext);
    }
  } finally {
    try {
      if (r4AttemptEvidenceDirectory) {
        for (const name of ['semantic-record.json','diagnostic.json','job-capture.json','first-rejection.json','job-rejection-evidence.json','holder-result.json','competitor-result.json','native-timeout-snapshot.json','native-timeout-snapshot-status.json']) {
          const source = resolve(sidecarRoot, name);
          const destination = resolve(r4AttemptEvidenceDirectory, `${traceCorrelation}-${name}`);
          const metadata = { expected_correlation: traceCorrelation, diagnostic_only: true, semantic_authority: false,
            status: 'unavailable', reason: 'not_produced', bytes: null, sha256: null };
          try {
            if (existsSync(source)) {
              if (statSync(source).size > 131072) throw new Error('snapshot_size_exceeded');
              const bytes = readFileSync(source);
              if (bytes.length > 131072) throw new Error('snapshot_size_exceeded');
              writeFileSync(destination, bytes, { flag: 'wx' });
              if (!readFileSync(destination).equals(bytes)) throw new Error('snapshot_copy_mismatch');
              Object.assign(metadata, { status: 'preserved', reason: null, bytes: bytes.length, sha256: sha256(bytes),
                source_mtime_ms: statSync(source).mtimeMs, semantic_correlation: correlation });
            }
          } catch { metadata.reason = 'snapshot_preservation_failed'; }
          saveR4AttemptEvidence(`${traceCorrelation}-${name}-preservation`, metadata);
        }
      }
    } catch { /* Evidence I/O must not replace the existing failure or skip cleanup. */ }
    finally { try {
      rmSync(sidecarRoot, { recursive: true, force: false });
      cleanup = existsSync(sidecarRoot) ? 'FAIL' : 'PASS';
    } catch {
      cleanup = 'FAIL';
    } }
  }
  if (!observation) {
    observation = {
      records: [],
      malformed: ['inspection_unavailable'],
      validation_codes: ['M40_SIDECAR_READ_FAILED'],
      signatures: [],
      occurrence_count: 0,
      present: false,
      preexisting,
      size_bytes: null,
      stale: false,
      late: false,
      expected_correlation: correlation,
      cleanup
    };
  }
  observation.cleanup = cleanup;
  if (traceObservation && cleanup !== 'PASS') traceObservation = inspectM40Trace({ ...traceContext, cleanup });
  if (jobCapture && cleanup !== 'PASS') jobCapture = inspectM40JobCapture({ ...jobContext, cleanup });
  return { ...result, m40_sidecar: observation, m40_trace: traceObservation, m40_trace_context: traceContext, m40_job_capture: jobCapture };
}

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function exactSortedSet(actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return new Set(actualSorted).size === actualSorted.length
    && new Set(expectedSorted).size === expectedSorted.length
    && actualSorted.length === expectedSorted.length
    && actualSorted.every((value, index) => value === expectedSorted[index]);
}

function diagnosticLineSecurityCodes(line, stream) {
  const codes = new Set();
  const privatePath = /(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s:]+|\/(?:Users|home)\/[^/\s:]+\/)/i.test(line);
  const sensitive = /(?:\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|postgres(?:ql)?:\/\/|(?:password|credential|secret|service[_-]?role|api[_-]?key|private[_-]?key)\s*[=:]|(?:https?:\/\/)?[a-z0-9]{20}\.supabase\.(?:co|in))/i.test(line);
  const sidecarPayload = /@@TECM_M40_SEMANTIC@@|"schema"\s*:\s*"tecm\.m40\.semantic\./.test(line);
  const rawM40Sql = stream === 'stderr'
    && /(?:teacher_attendance_contention|submit_teacher_attendance|statement_timeout|SQLSTATE\s*57014|(?:^|\W)57014(?:\W|$))/i.test(line);
  const terminalErrorRecord = stream === 'stderr'
    && /(?:M40_EXPECTED_TERMINAL_FAILURE|(?:^|\s)(?:Exception|RuntimeException|ParserError|Write-Error):|CategoryInfo\s*:|FullyQualifiedErrorId\s*:)/i.test(line);
  if (privatePath) codes.add(m40DiagnosticRejectionCodes.privatePath);
  if (sensitive) codes.add(m40DiagnosticRejectionCodes.sensitive);
  if (sidecarPayload) codes.add(m40DiagnosticRejectionCodes.sidecarPayload);
  if (rawM40Sql) codes.add(m40DiagnosticRejectionCodes.rawM40Sql);
  if (terminalErrorRecord) codes.add(m40DiagnosticRejectionCodes.terminalErrorRecord);
  return [...codes].sort();
}

function expectedPostgresNotice(line) {
  const notice = approvedPreterminalNotices.get(line);
  if (!notice) return null;
  return {
    category: 'expected_preterminal_sql_notice',
    source: notice.source,
    severity: 'NOTICE'
  };
}

function classifyExpectedPreterminalDiagnostic(line) {
  const notice = expectedPostgresNotice(line);
  if (notice) return notice;
  return null;
}

function rawStdoutDiagnosticLines(stdout) {
  return String(stdout ?? '').split(/\r?\n/).filter((line) =>
    /^\s*(?:psql:|(?:ERROR|CONTEXT|LOCATION|FATAL|PANIC|Exception|RuntimeException|ParserError|OperationStopped):|SQLSTATE\b)/i.test(line)
  );
}

function unknownProcessDiagnosticMetadata(result) {
  if (!result.m40_trace_context) return [];
  const context = result.m40_trace_context;
  const metadata = [];
  for (const stream of ['stdout', 'stderr']) {
    const lines = stream === 'stdout' ? rawStdoutDiagnosticLines(result.stdout)
      : String(result.stderr ?? '').split(/\r?\n/).filter(line => line && !expectedPostgresNotice(line)
        && !/^\[M40 REJECT\] M40_[A-Z0-9_]+$/.test(line));
    for (const line of lines.slice(0, 128)) {
      const bytes = Buffer.from(line, 'utf8');
      const outerFailure = stream === 'stderr' && line === databaseFailureDiagnostic;
      metadata.push({
        schema: m40TraceEventSchema, correlation: context.correlation,
        producer: 'teacher-attendance-history-mutation-verify.mjs/diagnostic', sequence: metadata.length + 1,
        phase: outerFailure ? 'outer_failure' : 'phase_unknown', stream,
        observed_at_ms: context.finishedAt,
        sqlstate: line.match(/(?:ERROR|FATAL|PANIC|SQLSTATE):?\s+([0-9A-Z]{5})(?::|\b)/)?.[1] ?? null,
        classification: outerFailure ? 'outer_verifier_failure' : 'unclassified_diagnostic',
        byte_count: Math.min(bytes.length, 16384), oversized: bytes.length > 16384,
        digest: sha256(bytes.subarray(0, 16384))
      });
    }
  }
  return metadata;
}

function diagnosticFingerprintProfile(stderr, { requireCompleteVerifierShape = false } = {}) {
  const lines = String(stderr ?? '').split(/\r?\n/).filter((line) => line.length > 0);
  const rejectionCodes = new Set();
  const entries = [];
  const sourceSeverityCounts = new Map();
  const noticeCounts = new Map();
  for (const line of lines) {
    for (const code of diagnosticLineSecurityCodes(line, 'stderr')) rejectionCodes.add(code);
    const origin = classifyExpectedPreterminalDiagnostic(line);
    if (!origin) {
      rejectionCodes.add(m40DiagnosticRejectionCodes.unclassified);
      continue;
    }
    const fingerprint = sha256(Buffer.from(line, 'utf8'));
    const count = (noticeCounts.get(line) ?? 0) + 1;
    noticeCounts.set(line, count);
    if (count > approvedPreterminalNotices.get(line).count) rejectionCodes.add(m40DiagnosticRejectionCodes.baselineMismatch);
    entries.push({ fingerprint, ...origin });
    const key = `${origin.source}|${origin.severity}`;
    sourceSeverityCounts.set(key, (sourceSeverityCounts.get(key) ?? 0) + 1);
  }
  const completeShape = sourceSeverityCounts.size === expectedPreterminalDiagnosticCounts.size
    && noticeCounts.size === approvedPreterminalNotices.size
    && [...approvedPreterminalNotices].every(([line, expected]) => noticeCounts.get(line) === expected.count)
    && [...expectedPreterminalDiagnosticCounts].every(([key, count]) => sourceSeverityCounts.get(key) === count)
    && lines.length === expectedPreterminalNoticeCount
    && entries.length === lines.length;
  if (requireCompleteVerifierShape && !completeShape) {
    rejectionCodes.add(m40DiagnosticRejectionCodes.baselineMismatch);
  }
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.fingerprint}|${entry.category}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...current, count: current.count + 1 }
      : { ...entry, count: 1 });
  }
  const categories = new Map();
  for (const { category } of entries) categories.set(category, (categories.get(category) ?? 0) + 1);
  return {
    safe: rejectionCodes.size === 0,
    complete_verifier_shape: completeShape,
    stderr_empty: lines.length === 0,
    stderr_line_count: lines.length,
    unknown_diagnostic_count: lines.length - entries.length,
    stderr_sha256: sha256(Buffer.from(String(stderr ?? ''), 'utf8')),
    categories: [...categories].sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
    source_severity_counts: [...sourceSeverityCounts].sort(([left], [right]) => left.localeCompare(right))
      .map(([source_severity, count]) => ({ source_severity, count })),
    fingerprints: [...grouped.values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
    rejection_codes: [...rejectionCodes].sort()
  };
}

function classifyM40DiagnosticSafety(result, baselineProfile = null) {
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const lines = stderr.split(/\r?\n/).filter((line) => line.length > 0);
  const expected = new Map((baselineProfile?.fingerprints ?? []).map((entry) => [
    `${entry.fingerprint}|${entry.category}`,
    { ...entry, remaining: entry.count }
  ]));
  const rejectionCodes = new Set();
  const categories = new Map();
  const rejectionProtocol = parseM40RejectionRecords({
    stdout: stdout.split(/\r?\n/), stderr: stderr.split(/\r?\n/)
  });
  const fixedFailureAllowed = result.status === 1 && !result.error && !result.signal
    && rejectionProtocol.occurrence_count > 0 && rejectionProtocol.validation_codes.length === 0
    && lines.filter((line) => line === databaseFailureDiagnostic).length === 1;
  let unexpectedStderrLines = 0;
  const addCategory = (category) => categories.set(category, (categories.get(category) ?? 0) + 1);
  for (const line of lines) {
    if (fixedFailureAllowed && line === databaseFailureDiagnostic) {
      addCategory('sanitized_verifier_failure');
      continue;
    }
    const machineRejection = line.match(/^\[M40 REJECT\] (M40_[A-Z0-9_]+)$/);
    if (machineRejection && m40KnownRejectionCodes.has(machineRejection[1])) {
      addCategory('sanitized_m40_rejection');
      continue;
    }
    const fingerprint = sha256(Buffer.from(line, 'utf8'));
    const expectedEntry = [...expected.values()].find((entry) => (
      entry.fingerprint === fingerprint && entry.remaining > 0
    ));
    if (expectedEntry) {
      expectedEntry.remaining -= 1;
      addCategory(expectedEntry.category);
      continue;
    }
    unexpectedStderrLines += 1;
    const specificCodes = diagnosticLineSecurityCodes(line, 'stderr');
    for (const code of specificCodes) rejectionCodes.add(code);
    if (specificCodes.length === 0) rejectionCodes.add(m40DiagnosticRejectionCodes.unclassified);
    addCategory(specificCodes.length > 0 ? 'forbidden_diagnostic' : 'unclassified_diagnostic');
  }
  const missingBaselineLines = [...expected.values()].reduce((count, entry) => count + entry.remaining, 0);
  if (missingBaselineLines > 0 || baselineProfile?.safe === false) {
    rejectionCodes.add(m40DiagnosticRejectionCodes.baselineMismatch);
  }
  const outputSidecarCodes = [
    ...diagnosticLineSecurityCodes(stdout, 'stdout'),
    ...diagnosticLineSecurityCodes(stderr, 'stderr')
  ].filter((code) => code === m40DiagnosticRejectionCodes.sidecarPayload);
  for (const code of outputSidecarCodes) rejectionCodes.add(code);
  const stdoutDiagnostics = rawStdoutDiagnosticLines(stdout);
  if (stdoutDiagnostics.length > 0) rejectionCodes.add(m40DiagnosticRejectionCodes.unclassified);
  const terminalProtocolVisible = stdout.split(/\r?\n/).some((line) => (
    line === m40ExpectedTerminationLine || line.startsWith(m40TerminalPrefix)
  ));
  if (terminalProtocolVisible && unexpectedStderrLines > 0) {
    rejectionCodes.add(m40DiagnosticRejectionCodes.postSentinel);
  }
  const terminalErrorRecordCount = lines.filter((line) => (
    diagnosticLineSecurityCodes(line, 'stderr').includes(m40DiagnosticRejectionCodes.terminalErrorRecord)
  )).length;
  const rawM40SqlCount = lines.filter((line) => (
    diagnosticLineSecurityCodes(line, 'stderr').includes(m40DiagnosticRejectionCodes.rawM40Sql)
  )).length;
  return {
    safe: rejectionCodes.size === 0,
    whole_process_stderr_empty: lines.length === 0,
    stderr_line_count: lines.length,
    stdout_diagnostic_count: stdoutDiagnostics.length,
    unknown_diagnostic_count: (categories.get('unclassified_diagnostic') ?? 0) + stdoutDiagnostics.length,
    terminal_added_stderr_count: unexpectedStderrLines,
    terminal_error_record_count: terminalErrorRecordCount,
    raw_m40_sql_diagnostic_count: rawM40SqlCount,
    sidecar_payload_count: outputSidecarCodes.length,
    reserved_unauthorized_marker_count: countOccurrences(outputOf(result), m40SemanticPrefix),
    expected_baseline_line_count: (baselineProfile?.fingerprints ?? [])
      .reduce((count, entry) => count + entry.count, 0),
    missing_baseline_line_count: missingBaselineLines,
    baseline_exact_match: missingBaselineLines === 0 && unexpectedStderrLines === 0,
    categories: [...categories].sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => ({ category, count })),
    rejection_codes: [...rejectionCodes].sort()
  };
}

function inspectDatabaseVerifierTerminalAst(root = repoRoot) {
  const sourcePath = resolve(root, databaseVerifierPath);
  const astScript = String.raw`
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $env:TECM_M40_AST_SOURCE,
  [ref]$tokens,
  [ref]$errors
)
$exits = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ExitStatementAst] }, $true))
$returns = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ReturnStatementAst] }, $true))
$rootReturns = @($returns | Where-Object {
  $cursor = $_.Parent
  $nestedScope = $false
  while ($cursor) {
    if ($cursor -is [System.Management.Automation.Language.FunctionDefinitionAst] -or
        $cursor -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
      $nestedScope = $true
      break
    }
    $cursor = $cursor.Parent
  }
  -not $nestedScope
})
$exitNode = if ($exits.Count -eq 1) { $exits[0] } else { $null }
$pipeline = if ($exitNode) { $exitNode.Pipeline } else { $null }
$pipelineElement = if ($pipeline -and $pipeline.PipelineElements.Count -eq 1) { $pipeline.PipelineElements[0] } else { $null }
$expression = if ($pipelineElement -is [System.Management.Automation.Language.CommandExpressionAst]) { $pipelineElement.Expression } else { $null }
$statementBlock = if ($exitNode -and $exitNode.Parent -is [System.Management.Automation.Language.StatementBlockAst]) { $exitNode.Parent } else { $null }
$ancestors = @()
$cursor = if ($exitNode) { $exitNode.Parent } else { $null }
while ($cursor) {
  $ancestors += $cursor.GetType().Name
  $cursor = $cursor.Parent
}
[pscustomobject]@{
  parse_error_count = $errors.Count
  exit_count = $exits.Count
  root_return_count = $rootReturns.Count
  exit_text = if ($exitNode) { $exitNode.Extent.Text } else { $null }
  pipeline_type = if ($pipeline) { $pipeline.GetType().Name } else { $null }
  pipeline_element_type = if ($pipelineElement) { $pipelineElement.GetType().Name } else { $null }
  expression_type = if ($expression) { $expression.GetType().Name } else { $null }
  literal_value = if ($expression -is [System.Management.Automation.Language.ConstantExpressionAst]) { $expression.Value } else { $null }
  literal_static_type = if ($expression) { $expression.StaticType.FullName } else { $null }
  statement_types = if ($statementBlock) { @($statementBlock.Statements | ForEach-Object { $_.GetType().Name }) } else { @() }
  preceding_statement_text = if ($statementBlock -and $statementBlock.Statements.Count -eq 2) { $statementBlock.Statements[0].Extent.Text } else { $null }
  block_trap_count = if ($statementBlock) { $statementBlock.Traps.Count } else { $null }
  ancestor_types = $ancestors
} | ConvertTo-Json -Compress -Depth 8
`;
  const environment = databaseProbeEnvironment({ TECM_M40_AST_SOURCE: sourcePath });
  const result = spawnSync('pwsh', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', astScript
  ], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 512 * 1024
  });
  let ast = null;
  try {
    ast = JSON.parse(result.stdout ?? '');
  } catch {
    ast = null;
  }
  const expectedAncestors = [
    'StatementBlockAst', 'IfStatementAst',
    'StatementBlockAst', 'IfStatementAst',
    'StatementBlockAst', 'IfStatementAst',
    'NamedBlockAst', 'ScriptBlockAst'
  ];
  const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
  const accepted = result.status === 0 && !result.error && !result.signal && ast
    && ast.parse_error_count === 0
    && ast.exit_count === 1
    && ast.root_return_count === 0
    && ast.exit_text === 'exit 1'
    && ast.pipeline_type === 'PipelineAst'
    && ast.pipeline_element_type === 'CommandExpressionAst'
    && ast.expression_type === 'ConstantExpressionAst'
    && ast.literal_value === 1
    && ast.literal_static_type === 'System.Int32'
    && exactSortedSet(ast.statement_types, ['ExitStatementAst', 'PipelineAst'])
    && ast.statement_types[0] === 'PipelineAst'
    && ast.statement_types[1] === 'ExitStatementAst'
    && ast.preceding_statement_text === 'Write-M40TerminalOutcome'
    && ast.block_trap_count === 0
    && ast.ancestor_types.length === expectedAncestors.length
    && ast.ancestor_types.every((value, index) => value === expectedAncestors[index])
    && countOccurrences(source, m40ExpectedTerminalFailure) === 0;
  return {
    accepted,
    parse_error_count: ast?.parse_error_count ?? null,
    exit_count: ast?.exit_count ?? null,
    root_return_count: ast?.root_return_count ?? null,
    exit_argument: {
      pipeline_type: ast?.pipeline_type ?? null,
      element_type: ast?.pipeline_element_type ?? null,
      expression_type: ast?.expression_type ?? null,
      literal_value: ast?.literal_value ?? null,
      static_type: ast?.literal_static_type ?? null
    },
    direct_statement_types: ast?.statement_types ?? [],
    direct_predecessor: ast?.preceding_statement_text ?? null,
    ancestor_types: ast?.ancestor_types ?? [],
    old_throw_token_occurrences: countOccurrences(source, m40ExpectedTerminalFailure),
    process: {
      exit_code: result.status,
      signal: result.signal ?? null,
      error_code: result.error?.code ?? null,
      stderr_empty: String(result.stderr ?? '').length === 0
    }
  };
}

function runIsolatedLiteralExitOneProbe() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'tecm-m40-literal-exit-one-'));
  const probePath = resolve(tempRoot, 'literal-exit-one.ps1');
  const original = Buffer.from('exit 0\n', 'utf8');
  let result = null;
  let mutation = null;
  let restored = false;
  let cleaned = false;
  try {
    writeFileSync(probePath, original);
    mutation = mutateBytes(original, {
      id: 'M40-LITERAL-EXIT-ONE-PROBE',
      search: 'exit 0',
      replacement: 'exit 1'
    });
    writeFileSync(probePath, mutation.bytes);
    result = spawnSync('pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', probePath
    ], {
      cwd: tempRoot,
      encoding: 'utf8',
      env: databaseProbeEnvironment(),
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 256 * 1024
    });
    writeFileSync(probePath, original);
    restored = readFileSync(probePath).equals(original);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
  }
  const candidateSource = mutation ? new TextDecoder('utf-8', { fatal: true }).decode(mutation.bytes) : '';
  const rejectionCodes = [];
  if (mutation?.matches !== 1 || candidateSource !== 'exit 1\n') rejectionCodes.push('M40_LITERAL_EXIT_PROBE_SOURCE_INVALID');
  if (result?.status !== 1) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_STATUS_INVALID');
  if (result?.signal) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_SIGNAL');
  if (result?.error) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_PROCESS_ERROR');
  if (String(result?.stdout ?? '').length !== 0) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_STDOUT_NONEMPTY');
  if (String(result?.stderr ?? '').length !== 0) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_STDERR_NONEMPTY');
  if (!restored) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_RESTORATION_FAILED');
  if (!cleaned) rejectionCodes.push('M40_LITERAL_EXIT_PROBE_CLEANUP_FAILED');
  return {
    accepted: rejectionCodes.length === 0,
    expected_rejection_codes: [],
    observed_rejection_codes: rejectionCodes.sort(),
    exact_rejection_set: exactSortedSet(rejectionCodes, []),
    candidate_changed: mutation ? !mutation.bytes.equals(original) : false,
    mutation_target_count: mutation?.matches ?? null,
    literal_source_exact: candidateSource === 'exit 1\n',
    uses_file_entrypoint: true,
    throw_absent: !/\bthrow\b/i.test(candidateSource),
    write_error_absent: !/\bWrite-Error\b/i.test(candidateSource),
    dynamic_invocation_absent: !/[&.]\s*\{/.test(candidateSource),
    wrapper_absent: candidateSource === 'exit 1\n',
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    process_error: result?.error?.code ?? null,
    stdout_bytes: Buffer.byteLength(String(result?.stdout ?? '')),
    stderr_bytes: Buffer.byteLength(String(result?.stderr ?? '')),
    restoration: restored ? 'PASS' : 'FAIL',
    cleanup: cleaned ? 'PASS' : 'FAIL'
  };
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function m40SemanticRecordValidationCodes(record, expectedCorrelation) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['M40_RECORD_TYPE_INVALID'];
  }
  if (!exactKeys(record, ['schema', 'producer', 'correlation', 'race', 'classification', 'sql', 'worker', 'readiness', 'lifecycle'])) {
    return ['M40_RECORD_TOP_LEVEL_FIELDS_INVALID'];
  }

  const codes = [];
  if (record.schema !== m40SemanticSchema) codes.push('M40_RECORD_SCHEMA_VERSION_INVALID');
  if (record.producer !== m40SemanticProducer) codes.push('M40_RECORD_PRODUCER_INVALID');
  if (record.correlation !== expectedCorrelation) codes.push('M40_RECORD_CORRELATION_INVALID');
  if (typeof record.correlation !== 'string'
      || typeof record.race !== 'string'
      || typeof record.classification !== 'string'
      || typeof record.readiness !== 'string') {
    codes.push('M40_RECORD_TOP_LEVEL_TYPES_INVALID');
  }

  if (!exactKeys(record.sql, ['classification', 'sqlstate', 'error_identifier', 'elapsed_milliseconds', 'unauthorized_marker_observed'])) {
    codes.push('M40_RECORD_SQL_FIELDS_INVALID');
  } else if (!(
    (record.sql.classification === null || typeof record.sql.classification === 'string')
    && (record.sql.sqlstate === null || /^[0-9A-Z]{5}$/.test(record.sql.sqlstate))
    && (record.sql.error_identifier === null || typeof record.sql.error_identifier === 'string')
    && (record.sql.elapsed_milliseconds === null
      || (typeof record.sql.elapsed_milliseconds === 'number' && Number.isFinite(record.sql.elapsed_milliseconds)))
    && typeof record.sql.unauthorized_marker_observed === 'boolean'
  )) {
    codes.push('M40_RECORD_SQL_TYPES_INVALID');
  }

  if (!exactKeys(record.worker, ['state', 'exit_code', 'timed_out', 'signal', 'process_error'])) {
    codes.push('M40_RECORD_WORKER_FIELDS_INVALID');
  } else if (!(
    typeof record.worker.state === 'string'
    && (record.worker.exit_code === null || Number.isInteger(record.worker.exit_code))
    && typeof record.worker.timed_out === 'boolean'
    && (record.worker.signal === null || typeof record.worker.signal === 'string')
    && (record.worker.process_error === null || typeof record.worker.process_error === 'string')
  )) {
    codes.push('M40_RECORD_WORKER_TYPES_INVALID');
  }

  if (!exactKeys(record.lifecycle, [
    'semantic_candidate',
    'post_candidate_assertion',
    'holder_release',
    'holder_terminal',
    'competitor_terminal',
    'jobs_stopped',
    'jobs_removed',
    'barrier_cleanup',
    'finalization',
    'rejection_codes',
    'failure_sqlstate'
  ])) {
    codes.push('M40_RECORD_LIFECYCLE_FIELDS_INVALID');
  } else {
    const lifecycle = record.lifecycle;
    const lifecycleStatesValid = ['PASS', 'REJECTED', 'FAIL'].includes(lifecycle.semantic_candidate)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.post_candidate_assertion)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.holder_release)
      && ['PASS', 'FAIL', 'NOT_STARTED'].includes(lifecycle.holder_terminal)
      && ['PASS', 'FAIL', 'NOT_STARTED'].includes(lifecycle.competitor_terminal)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.jobs_stopped)
      && ['PASS', 'FAIL', 'NOT_RUN'].includes(lifecycle.jobs_removed)
      && ['PASS', 'FAIL', 'NOT_RUN'].includes(lifecycle.barrier_cleanup)
      && ['PASS', 'FAIL'].includes(lifecycle.finalization);
    const rejectionCodesValid = Array.isArray(lifecycle.rejection_codes)
      && lifecycle.rejection_codes.every((code) => typeof code === 'string' && /^M40_[A-Z0-9_]+$/.test(code))
      && new Set(lifecycle.rejection_codes).size === lifecycle.rejection_codes.length
      && lifecycle.rejection_codes.every((code, index) => index === 0 || lifecycle.rejection_codes[index - 1] < code);
    const failureSqlStateValid = lifecycle.failure_sqlstate === null
      || (typeof lifecycle.failure_sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(lifecycle.failure_sqlstate));
    if (!lifecycleStatesValid || !rejectionCodesValid || !failureSqlStateValid) {
      codes.push('M40_RECORD_LIFECYCLE_TYPES_INVALID');
    } else {
      const successfulFinalization = lifecycle.post_candidate_assertion !== 'FAIL'
        && lifecycle.holder_release === 'PASS'
        && lifecycle.holder_terminal === 'PASS'
        && lifecycle.competitor_terminal === 'PASS'
        && ['PASS', 'NOT_REQUIRED'].includes(lifecycle.jobs_stopped)
        && lifecycle.jobs_removed === 'PASS'
        && lifecycle.barrier_cleanup === 'PASS';
      if ((lifecycle.finalization === 'PASS' && !successfulFinalization)
          || (lifecycle.finalization === 'FAIL' && lifecycle.rejection_codes.length === 0)) {
        codes.push('M40_RECORD_LIFECYCLE_INCONSISTENT');
      }
    }
  }
  return codes.sort();
}

function semanticSignature(record) {
  return [
    record.classification,
    record.sql.classification ?? 'null',
    record.sql.sqlstate ?? 'null',
    record.sql.error_identifier ?? 'null',
    String(record.sql.unauthorized_marker_observed)
  ].join('|');
}

function lifecycleSignature(record) {
  return [
    record.lifecycle.semantic_candidate,
    record.lifecycle.post_candidate_assertion,
    record.lifecycle.holder_release,
    record.lifecycle.holder_terminal,
    record.lifecycle.competitor_terminal,
    record.lifecycle.jobs_stopped,
    record.lifecycle.jobs_removed,
    record.lifecycle.barrier_cleanup,
    record.lifecycle.finalization,
    record.lifecycle.rejection_codes.join(','),
    record.lifecycle.failure_sqlstate ?? 'null'
  ].join('|');
}

function isM40SemanticCandidateRecord(record) {
  return record.race === 'teacher-attendance-contention-existing'
    && record.classification === 'm40_blocking_contention'
    && record.sql.classification === 'm40_blocking_statement_timeout_v1'
    && record.sql.sqlstate === '57014'
    && record.sql.error_identifier === 'statement_timeout'
    && record.sql.elapsed_milliseconds >= 2500
    && record.sql.elapsed_milliseconds < 5000
    && record.worker.state === 'Completed'
    && record.worker.exit_code === 0
    && record.worker.timed_out === false
    && record.worker.signal === null
    && record.worker.process_error === null
    && record.readiness === 'PASS';
}

function isExpectedM40Record(record) {
  return isM40SemanticCandidateRecord(record)
    && record.sql.unauthorized_marker_observed === false
    && record.lifecycle.semantic_candidate === 'PASS'
    && record.lifecycle.post_candidate_assertion === 'PASS'
    && record.lifecycle.holder_release === 'PASS'
    && record.lifecycle.holder_terminal === 'PASS'
    && record.lifecycle.competitor_terminal === 'PASS'
    && ['PASS', 'NOT_REQUIRED'].includes(record.lifecycle.jobs_stopped)
    && record.lifecycle.jobs_removed === 'PASS'
    && record.lifecycle.barrier_cleanup === 'PASS'
    && record.lifecycle.finalization === 'PASS'
    && record.lifecycle.rejection_codes.length === 0
    && record.lifecycle.failure_sqlstate === null;
}

function m40TerminalRecordValidationCodes(record, expectedCorrelation) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['M40_TERMINAL_RECORD_TYPE_INVALID'];
  }
  if (!exactKeys(record, [
    'schema', 'producer', 'correlation', 'outcome', 'database_cleanup', 'container_cleanup'
  ])) {
    return ['M40_TERMINAL_RECORD_FIELDS_INVALID'];
  }
  const codes = [];
  if (record.schema !== m40TerminalSchema) codes.push('M40_TERMINAL_SCHEMA_VERSION_INVALID');
  if (record.producer !== m40TerminalProducer) codes.push('M40_TERMINAL_PRODUCER_INVALID');
  if (typeof record.correlation !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.correlation)
      || record.correlation !== expectedCorrelation) {
    codes.push('M40_TERMINAL_CORRELATION_INVALID');
  }
  if (record.outcome !== m40ExpectedTermination) codes.push('M40_TERMINAL_OUTCOME_INVALID');
  if (record.database_cleanup !== 'PASS' || record.container_cleanup !== 'PASS') {
    codes.push('M40_TERMINAL_CLEANUP_INVALID');
  }
  return codes.sort();
}

function parseM40RejectionRecords(streams) {
  const records = [];
  const validationCodes = new Set();
  for (const [stream, lines] of Object.entries(streams)) {
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith('[M40 REJECT]')) continue;
      const match = line.match(/^\[M40 REJECT\] (M40_[A-Z0-9_]+)$/);
      if (!match) {
        validationCodes.add('M40_REJECTION_RECORD_MALFORMED');
        records.push({ stream, index, code: null, known: false, malformed: true });
        continue;
      }
      const code = match[1];
      const known = m40KnownRejectionCodes.has(code);
      if (!known) validationCodes.add('M40_REJECTION_RECORD_UNKNOWN');
      records.push({ stream, index, code, known, malformed: false });
    }
  }
  const occurrences = new Map();
  for (const record of records) {
    if (record.code) occurrences.set(record.code, (occurrences.get(record.code) ?? 0) + 1);
  }
  if ([...occurrences.values()].some((count) => count > 1)) {
    validationCodes.add('M40_REJECTION_RECORD_DUPLICATE');
  }
  return {
    occurrence_count: records.length,
    records,
    rejection_codes: [...new Set(records.filter(({ known }) => known).map(({ code }) => code))].sort(),
    unknown_codes: [...new Set(records.filter(({ code, known }) => code && !known).map(({ code }) => code))].sort(),
    validation_codes: [...validationCodes].sort()
  };
}

function parseM40TerminalRecords(streams, expectedCorrelation, terminalRequired) {
  const candidates = [];
  const validationCodes = new Set();
  for (const [stream, lines] of Object.entries(streams)) {
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith(m40TerminalPrefix)) continue;
      const payload = line.slice(m40TerminalPrefix.length);
      let record = null;
      let codes = [];
      try {
        record = parseM40Json(payload);
        codes = m40TerminalRecordValidationCodes(record, expectedCorrelation);
      } catch {
        codes = ['M40_TERMINAL_RECORD_JSON_INVALID'];
      }
      if (stream !== 'stdout') codes.push('M40_TERMINAL_RECORD_STREAM_INVALID');
      for (const code of codes) validationCodes.add(code);
      candidates.push({ stream, index, record, validation_codes: [...new Set(codes)].sort() });
    }
  }
  if (terminalRequired && candidates.length === 0) {
    validationCodes.add('M40_TERMINAL_RECORD_MISSING');
  } else if (candidates.length > 1) {
    validationCodes.add('M40_TERMINAL_RECORD_COUNT_INVALID');
  }
  const valid = candidates.filter(({ validation_codes: codes }) => codes.length === 0);
  return {
    occurrence_count: candidates.length,
    valid_count: valid.length,
    records: candidates,
    record: candidates.length === 1 ? candidates[0].record : null,
    stdout_index: valid.length === 1 && valid[0].stream === 'stdout' ? valid[0].index : null,
    validation_codes: [...validationCodes].sort()
  };
}

function m40ProcessProtocol(result, expectedCorrelation, { terminalRequired = false } = {}) {
  const streams = {
    stdout: (result.stdout ?? '').split(/\r?\n/),
    stderr: (result.stderr ?? '').split(/\r?\n/)
  };
  const lines = streams.stdout;
  const indices = (expected) => lines.flatMap((line, index) => line === expected ? [index] : []);
  const candidate = indices(m40LifecycleCandidateLine);
  const finalization = indices(m40LifecycleFinalizationLine);
  const sidecar = indices(m40LifecycleSidecarLine);
  const termination = indices(m40ExpectedTerminationLine);
  const cleanupRecords = lines.flatMap((line, index) => {
    const match = line.match(/^\[CLEANUP\] database=(PASS|FAIL) container=(PASS|FAIL)$/);
    return match ? [{ index, database: match[1], container: match[2] }] : [];
  });
  const cleanup = cleanupRecords.map(({ index }) => index);
  const rejections = parseM40RejectionRecords(streams);
  const terminal = parseM40TerminalRecords(streams, expectedCorrelation, terminalRequired);
  const cardinalityValid = candidate.length === 1
    && finalization.length === 1
    && sidecar.length === 1
    && termination.length === 1
    && cleanup.length === 1
    && terminal.occurrence_count === 1
    && terminal.valid_count === 1;
  const orderingValid = cardinalityValid
    && candidate[0] < finalization[0]
    && finalization[0] < sidecar[0]
    && sidecar[0] < termination[0]
    && termination[0] < cleanup[0]
    && cleanup[0] < terminal.stdout_index;
  const validationCodes = new Set([...rejections.validation_codes, ...terminal.validation_codes]);
  if (cardinalityValid && !orderingValid) validationCodes.add('M40_TERMINAL_RECORD_ORDER_INVALID');
  const allowedAfterSidecar = (line) => line.length === 0
    || line === m40ExpectedTerminationLine
    || /^\[CLEANUP\] database=(PASS|FAIL) container=(PASS|FAIL)$/.test(line)
    || line.startsWith(m40TerminalPrefix)
    || line.startsWith('[M40 REJECT]');
  const unexpectedPostSidecarLines = sidecar.length === 1
    ? lines.slice(sidecar[0] + 1).filter((line) => !allowedAfterSidecar(line))
    : [];
  if (unexpectedPostSidecarLines.length > 0) validationCodes.add('M40_POST_SIDECAR_OUTPUT_INVALID');
  if (terminal.valid_count === 1 && rejections.occurrence_count > 0) {
    validationCodes.add('M40_TERMINAL_REJECTION_CONTRADICTION');
  }
  if (terminal.valid_count === 1 && cleanupRecords.length === 1
      && (terminal.record.database_cleanup !== cleanupRecords[0].database
        || terminal.record.container_cleanup !== cleanupRecords[0].container)) {
    validationCodes.add('M40_TERMINAL_CLEANUP_CONTRADICTION');
  }
  const exactPositiveSequence = orderingValid
    && validationCodes.size === 0
    && rejections.occurrence_count === 0;
  return {
    exact_positive_sequence: exactPositiveSequence,
    semantic_candidate_occurrences: candidate.length,
    finalization_occurrences: finalization.length,
    sidecar_commit_occurrences: sidecar.length,
    termination_occurrences: termination.length,
    cleanup_occurrences: cleanup.length,
    terminal_required: terminalRequired,
    terminal_record: terminal.record,
    terminal_record_occurrences: terminal.occurrence_count,
    terminal_record_valid: terminal.valid_count === 1,
    terminal_record_validation_codes: terminal.validation_codes,
    rejection_occurrences: rejections.occurrence_count,
    rejection_records: rejections.records,
    rejection_unknown_codes: rejections.unknown_codes,
    rejection_codes: rejections.rejection_codes,
    validation_codes: [...validationCodes].sort(),
    unexpected_post_sidecar_lines: unexpectedPostSidecarLines
  };
}

function cleanupClassification(output) {
  const records = output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[CLEANUP\] database=(PASS|FAIL) container=(PASS|FAIL)$/);
    return match ? [{ database: match[1], container: match[2] }] : [];
  });
  return {
    occurrence_count: records.length,
    database: records.length === 1 ? records[0].database : 'FAIL',
    container: records.length === 1 ? records[0].container : 'FAIL'
  };
}

function testFailureClassification(result, mutation) {
  const output = outputOf(result);
  const escapedName = mutation.expectedTest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namedFailure = new RegExp(`not ok \\d+ - ${escapedName}(?:\\r?\\n|$)`).test(output);
  const assertionFailure = /AssertionError/.test(output);
  const expectedSafetyFailure = output.includes(mutation.expectedFailure);
  const summary = /# fail 1(?:\r?\n|$)/.test(output) && /# cancelled 0(?:\r?\n|$)/.test(output);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    caught: result.status !== 0 && !timedOut && !result.signal
      && namedFailure && assertionFailure && expectedSafetyFailure && summary,
    exit_code: result.status,
    timed_out: timedOut,
    signal: result.signal ?? null,
    named_failure: namedFailure,
    assertion_failure: assertionFailure,
    expected_safety_failure: expectedSafetyFailure,
    exact_summary: summary
  };
}

function databaseFailureClassification(result, mutation, {
  diagnosticBaseline = null,
  terminalAst = null,
  terminalMechanism = null
} = {}) {
  const output = outputOf(result);
  const terminalFailureStdoutOccurrences = countOccurrences(result.stdout ?? '', m40ExpectedTerminalFailure);
  const terminalFailureStderrOccurrences = countOccurrences(result.stderr ?? '', m40ExpectedTerminalFailure);
  const streamDiagnosticSafety = classifyM40DiagnosticSafety(result, diagnosticBaseline);
  const traceUnknownCount = result.m40_trace?.unknown_diagnostic_count ?? 0;
  const diagnosticSafety = {
    ...streamDiagnosticSafety,
    stream_safe: streamDiagnosticSafety.safe,
    safe: streamDiagnosticSafety.safe && traceUnknownCount === 0,
    unknown_diagnostic_count: streamDiagnosticSafety.unknown_diagnostic_count + traceUnknownCount,
    trace_unknown_diagnostic_count: traceUnknownCount
  };
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const semantic = result.m40_sidecar ?? {
    records: [],
    malformed: ['missing_sidecar_observation'],
    validation_codes: ['M40_SIDECAR_MISSING'],
    signatures: [],
    occurrence_count: 0,
    present: false,
    preexisting: false,
    size_bytes: null,
    stale: false,
    late: false,
    cleanup: 'FAIL'
  };
  const cleanup = cleanupClassification(output);
  const unauthorizedProcessOutput = output.includes(m40SemanticPrefix);
  const expectedRecords = semantic.records.filter(isExpectedM40Record);
  const unexpectedRecords = semantic.records.filter((record) => !isExpectedM40Record(record));
  const terminalRequired = expectedRecords.length > 0
    || (result.stdout ?? '').split(/\r?\n/).some((line) => (
      line === m40LifecycleSidecarLine || line === m40ExpectedTerminationLine || line.startsWith(m40TerminalPrefix)
    ));
  const processProtocol = m40ProcessProtocol(result, semantic.expected_correlation ?? null, { terminalRequired });
  const exactSemanticClassification = semantic.occurrence_count === 1
    && semantic.malformed.length === 0
    && semantic.validation_codes.length === 0
    && expectedRecords.length === 1
    && unexpectedRecords.length === 0;
  const exactProcessFailure = result.status === 1 && !result.error && !result.signal;
  const authoritativeFinalizationSuccess = exactSemanticClassification
    && expectedRecords[0]?.lifecycle.finalization === 'PASS';
  const terminationProtocolFailure = terminalRequired && !processProtocol.exact_positive_sequence;
  const recordLifecycleFailure = semantic.records.some(({ lifecycle }) => lifecycle.finalization !== 'PASS');
  const lifecycleFailure = timedOut || Boolean(result.error) || Boolean(result.signal) || result.status === null
    || /Docker Desktop is not available|Could not start PostgreSQL|PostgreSQL did not become ready|cleanup failed|\[M40 SIDECAR WRITE FAILURE\]/i.test(output)
    || cleanup.database !== 'PASS' || cleanup.container !== 'PASS' || semantic.cleanup !== 'PASS'
    || recordLifecycleFailure || terminationProtocolFailure
    || processProtocol.validation_codes.length > 0
    || processProtocol.rejection_codes.includes('M40_SIDECAR_WRITE_FAILED')
    || (expectedRecords.length > 0 && processProtocol.rejection_codes.length > 0);
  const rejectionCodes = new Set(semantic.validation_codes);
  for (const code of result.m40_trace?.rejection_codes ?? []) rejectionCodes.add(code);
  for (const code of result.m40_job_capture?.rejection_codes ?? []) rejectionCodes.add(code);
  for (const code of processProtocol.rejection_codes) rejectionCodes.add(code);
  for (const code of processProtocol.validation_codes) rejectionCodes.add(code);
  for (const code of diagnosticSafety.rejection_codes) rejectionCodes.add(code);
  if (unauthorizedProcessOutput) rejectionCodes.add('M40_UNAUTHORIZED_PROCESS_OUTPUT');
  if (processProtocol.rejection_codes.includes('M40_SIDECAR_WRITE_FAILED')) rejectionCodes.add('M40_SIDECAR_WRITE_FAILED');
  if (terminationProtocolFailure) rejectionCodes.add('M40_TERMINATION_PROTOCOL_INVALID');
  for (const record of unexpectedRecords) {
    for (const code of record.lifecycle.rejection_codes) rejectionCodes.add(code);
    if (record.race !== 'teacher-attendance-contention-existing') {
      rejectionCodes.add('M40_RECORD_RACE_INVALID');
    }
    if (record.sql.unauthorized_marker_observed === true) {
      rejectionCodes.add('M40_UNAUTHORIZED_MARKER_OBSERVED');
    }
    if (record.classification === 'unrelated_sql_error') {
      rejectionCodes.add('M40_UNRELATED_SQL_FAILURE');
    }
    if (record.race === 'teacher-attendance-contention-existing'
        && record.sql.unauthorized_marker_observed !== true
        && record.classification !== 'unrelated_sql_error'
        && !isM40SemanticCandidateRecord(record)) {
      rejectionCodes.add('M40_SEMANTIC_RECORD_UNEXPECTED');
    }
  }
  if (result.status !== 1) rejectionCodes.add('M40_PROCESS_STATUS_INVALID');
  if (timedOut) rejectionCodes.add('M40_PROCESS_TIMEOUT');
  if (result.error && !timedOut) rejectionCodes.add('M40_PROCESS_ERROR');
  if (result.signal) rejectionCodes.add('M40_PROCESS_SIGNAL');
  if (cleanup.occurrence_count !== 1) rejectionCodes.add('M40_CLEANUP_RECORD_COUNT_INVALID');
  if (cleanup.database !== 'PASS') rejectionCodes.add('M40_DATABASE_CLEANUP_FAILED');
  if (cleanup.container !== 'PASS') rejectionCodes.add('M40_CONTAINER_CLEANUP_FAILED');
  if (semantic.cleanup !== 'PASS') rejectionCodes.add('M40_SIDECAR_CLEANUP_FAILED');
  if (lifecycleFailure) rejectionCodes.add('M40_LIFECYCLE_FAILURE_OBSERVED');
  return {
    caught: exactProcessFailure && exactSemanticClassification && authoritativeFinalizationSuccess
      && processProtocol.exact_positive_sequence && processProtocol.rejection_codes.length === 0
      && !unauthorizedProcessOutput && !lifecycleFailure && diagnosticSafety.safe
      && (result.m40_trace?.accepted ?? true) && (result.m40_job_capture?.accepted ?? true),
    diagnostic_trace: result.m40_trace ?? null,
    job_capture: result.m40_job_capture ?? null,
    process_diagnostic_metadata: unknownProcessDiagnosticMetadata(result),
    exit_code: result.status,
    timed_out: timedOut,
    signal: result.signal ?? null,
    process_error: result.error ? { code: result.error.code ?? null, message: result.error.message ?? String(result.error) } : null,
    exact_process_failure: exactProcessFailure,
    exact_semantic_classification: exactSemanticClassification,
    authoritative_finalization_success: authoritativeFinalizationSuccess,
    exact_termination_protocol: processProtocol.exact_positive_sequence,
    exact_terminal_outcome: processProtocol.terminal_record_valid,
    terminal_record: processProtocol.terminal_record,
    process_protocol: processProtocol,
    semantic_occurrence_count: semantic.occurrence_count,
    semantic_malformed: semantic.malformed,
    semantic_validation_codes: semantic.validation_codes,
    semantic_signatures: semantic.signatures,
    lifecycle_signatures: semantic.records.map(lifecycleSignature).sort(),
    lifecycle_records: semantic.records.map(({ lifecycle }) => lifecycle),
    lifecycle_rejection_codes: [...new Set(semantic.records.flatMap(({ lifecycle }) => lifecycle.rejection_codes))].sort(),
    lifecycle_failure_sqlstates: semantic.records.flatMap(({ lifecycle }) => lifecycle.failure_sqlstate ? [lifecycle.failure_sqlstate] : []).sort(),
    semantic_candidate_records: semantic.records.filter((record) => (
      record.lifecycle.semantic_candidate === 'PASS' && isM40SemanticCandidateRecord(record)
    )).length,
    semantic_sqlstates: semantic.records.map(({ sql }) => sql.sqlstate).sort(),
    expected_semantic_records: expectedRecords.length,
    unexpected_semantic_records: unexpectedRecords.length,
    unrelated_sql_classification: semantic.records.some(({ classification }) => classification === 'unrelated_sql_error'),
    unauthorized_process_output: unauthorizedProcessOutput,
    terminal_failure_sentinel: {
      stdout_occurrences: terminalFailureStdoutOccurrences,
      stderr_occurrences: terminalFailureStderrOccurrences,
      total_occurrences: terminalFailureStdoutOccurrences + terminalFailureStderrOccurrences,
      whole_process_stderr_empty: diagnosticSafety.whole_process_stderr_empty,
      terminal_error_record_absent: diagnosticSafety.terminal_error_record_count === 0,
      raw_m40_sql_diagnostic_absent: diagnosticSafety.raw_m40_sql_diagnostic_count === 0,
      terminal_diagnostic_sanitized: terminalFailureStderrOccurrences === 0
        && terminalFailureStdoutOccurrences === 0
        && diagnosticSafety.terminal_error_record_count === 0
        && diagnosticSafety.raw_m40_sql_diagnostic_count === 0
        && diagnosticSafety.sidecar_payload_count === 0
        && diagnosticSafety.reserved_unauthorized_marker_count === 0
    },
    diagnostic_safety: diagnosticSafety,
    production_terminal_contract: {
      accepted: terminalAst?.accepted === true
        && terminalMechanism?.accepted === true
        && terminalFailureStdoutOccurrences + terminalFailureStderrOccurrences === 0
        && exactSemanticClassification
        && authoritativeFinalizationSuccess
        && processProtocol.exact_positive_sequence
        && processProtocol.terminal_record_valid
        && processProtocol.termination_occurrences === 1
        && processProtocol.cleanup_occurrences === 1
        && result.status === 1 && !result.error && !result.signal
        && diagnosticSafety.safe
        && diagnosticSafety.terminal_error_record_count === 0
        && diagnosticSafety.raw_m40_sql_diagnostic_count === 0
        && diagnosticSafety.sidecar_payload_count === 0
        && diagnosticSafety.reserved_unauthorized_marker_count === 0,
      ast_authorized_literal_exit_one: terminalAst?.accepted ?? null,
      root_return_count: terminalAst?.root_return_count ?? null,
      isolated_literal_exit_one_silent: terminalMechanism?.accepted ?? null,
      old_throw_token_occurrences: terminalAst?.old_throw_token_occurrences ?? null,
      exact_sidecar: exactSemanticClassification,
      finalization_pass: authoritativeFinalizationSuccess,
      exact_terminal_protocol: processProtocol.exact_positive_sequence,
      exact_terminal_record: processProtocol.terminal_record_valid,
      exact_sentinel_occurrences: processProtocol.termination_occurrences,
      cleanup_occurrences: processProtocol.cleanup_occurrences,
      exit_code: result.status,
      terminal_error_record_count: diagnosticSafety.terminal_error_record_count,
      raw_m40_sql_diagnostic_count: diagnosticSafety.raw_m40_sql_diagnostic_count,
      sidecar_payload_count: diagnosticSafety.sidecar_payload_count,
      reserved_unauthorized_marker_count: diagnosticSafety.reserved_unauthorized_marker_count,
      whole_process_diagnostics_safe: diagnosticSafety.safe,
      whole_process_stderr_empty_required: false
    },
    lifecycle_failure: lifecycleFailure,
    database_cleanup: cleanup.database,
    container_cleanup: cleanup.container,
    cleanup_occurrence_count: cleanup.occurrence_count,
    sidecar_present: semantic.present,
    sidecar_preexisting: semantic.preexisting,
    sidecar_size_bytes: semantic.size_bytes,
    sidecar_stale: semantic.stale,
    sidecar_late: semantic.late,
    sidecar_cleanup: semantic.cleanup,
    rejection_codes: [...rejectionCodes].sort()
  };
}

function evaluateM40Caught({
  baselinePassed,
  mutationMatches,
  intendedMutationApplied,
  completeNoArgumentVerifierRan,
  classification,
  sourceRestoration,
  worktreeCleanup,
  workspaceCleanup
}) {
  const classifierRejectionCodes = classification.rejection_codes ?? [];
  const caught = baselinePassed === true
    && mutationMatches === 1
    && intendedMutationApplied === true
    && completeNoArgumentVerifierRan === true
    && classification.caught === true
    && classification.lifecycle_failure === false
    && classifierRejectionCodes.length === 0
    && classification.exact_semantic_classification === true
    && classification.authoritative_finalization_success === true
    && classification.exact_termination_protocol === true
    && classification.unrelated_sql_classification === false
    && classification.unauthorized_process_output === false
    && classification.timed_out === false
    && classification.signal === null
    && classification.process_error === null
    && classification.exit_code === 1
    && sourceRestoration === 'PASS'
    && classification.database_cleanup === 'PASS'
    && classification.container_cleanup === 'PASS'
    && worktreeCleanup === 'PASS'
    && workspaceCleanup === 'PASS';
  const rejectionCodes = new Set(classifierRejectionCodes);
  if (classification.caught !== true) rejectionCodes.add('M40_LOWER_CLASSIFIER_REJECTED');
  if (classification.lifecycle_failure !== false) rejectionCodes.add('M40_LIFECYCLE_FAILURE_OBSERVED');
  if (baselinePassed !== true) rejectionCodes.add('M40_BASELINE_INCOMPLETE');
  if (mutationMatches !== 1) rejectionCodes.add('M40_MUTATION_TARGET_COUNT_INVALID');
  if (intendedMutationApplied !== true) rejectionCodes.add('M40_INTENDED_MUTATION_NOT_APPLIED');
  if (completeNoArgumentVerifierRan !== true) rejectionCodes.add('M40_COMPLETE_VERIFIER_NOT_RUN');
  if (sourceRestoration !== 'PASS') rejectionCodes.add('M40_SOURCE_RESTORATION_FAILED');
  if (worktreeCleanup !== 'PASS') rejectionCodes.add('M40_WORKTREE_CLEANUP_FAILED');
  if (workspaceCleanup !== 'PASS') rejectionCodes.add('M40_WORKSPACE_CLEANUP_FAILED');
  return { caught, rejection_codes: [...rejectionCodes].sort() };
}

function runBaseline() {
  saveR4AttemptEvidence('teacher-baseline-start', { started_at: new Date().toISOString(),
    command: [process.execPath, '--experimental-strip-types', '--test', resolve(repoRoot, testPath)] });
  const result = runTest(repoRoot, undefined, { raw: true });
  if (r4AttemptEvidenceDirectory) {
    for (const stream of ['stdout', 'stderr']) {
      if (Buffer.isBuffer(result[stream])) writeFileSync(resolve(r4AttemptEvidenceDirectory,
        `teacher-baseline-${stream}.bin`), result[stream], { flag: 'wx' });
    }
  }
  const exit = { status: result.status, signal: result.signal, error: result.error ? String(result.error) : null,
    finished_at: new Date().toISOString(), representation: 'original parent-received process bytes in .bin files' };
  saveR4AttemptEvidence('teacher-baseline-exit', exit);
  if (result.status !== 0 || result.error || result.signal) {
    throw new VerifierError('BASELINE_FAILED', 'Teacher attendance mutation baseline must pass before mutation', {
      exit_code: result.status,
      timed_out: result.error?.code === 'ETIMEDOUT',
      signal: result.signal ?? null
    });
  }
  return { passed: true, ...exit };
}

function runDatabaseBaseline() {
  const result = runDatabaseProbe();
  const output = outputOf(result);
  const summaryPattern = m40AcceptanceMode
    ? /^\[PASS\] M40 acceptance database: repeatable migrations and seed, SQL suites 001-008\/017-019, bounded existing\/absent attendance contention, retry assertions, negative preflight$/m
    : /\[PASS\] repeatable migrations, negative preflight, repeatable seed, RLS, SQL suites 001-020,/;
  const completeScope = summaryPattern.test(output) && (!m40AcceptanceMode || (
    countOccurrences(output, '[CONTENTION PASS] teacher-attendance-contention-existing bounded classification, verified finalization, and no-side-effect proof') === 1
    && countOccurrences(output, '[CONTENTION PASS] teacher-attendance-contention-absent bounded classification, verified finalization, and no-side-effect proof') === 1
    && countOccurrences(output, '[PASS] m40_contention_retry_cleanup=PASS') === 1));
  const terminalRecordOccurrences = countOccurrences(output, m40TerminalPrefix);
  const terminalFailureOccurrences = countOccurrences(output, m40ExpectedTerminalFailure);
  const negativePreflightSummaryOccurrences = countOccurrences(result.stdout ?? '', negativePreflightSummary);
  const stdoutDiagnosticCount = rawStdoutDiagnosticLines(result.stdout).length;
  const outputSidecarCount = countOccurrences(output, m40SemanticPrefix);
  const diagnosticProfile = diagnosticFingerprintProfile(result.stderr, {
    requireCompleteVerifierShape: true
  });
  const terminalSourceAst = inspectDatabaseVerifierTerminalAst();
  const terminalMechanism = runIsolatedLiteralExitOneProbe();
  if (result.status !== 0 || result.error || result.signal
      || !completeScope
      || !/\[CLEANUP\] database=PASS container=PASS/.test(output)
      || terminalRecordOccurrences !== 0 || terminalFailureOccurrences !== 0
      || negativePreflightSummaryOccurrences !== 1
      || stdoutDiagnosticCount !== 0 || outputSidecarCount !== 0
      || !diagnosticProfile.safe || !diagnosticProfile.complete_verifier_shape
      || diagnosticProfile.stderr_line_count !== expectedPreterminalNoticeCount
      || !terminalSourceAst.accepted || !terminalMechanism.accepted) {
    throw new VerifierError('DATABASE_BASELINE_FAILED', 'Database baseline must prove its declared scope and cleanup', {
      exit_code: result.status,
      timed_out: result.error?.code === 'ETIMEDOUT',
      signal: result.signal ?? null,
      process_error_code: result.error?.code ?? null,
      complete_scope: completeScope,
      scope: m40AcceptanceMode ? 'm40-acceptance' : 'repository-database',
      database_cleanup: /\[CLEANUP\] database=PASS/.test(output),
      container_cleanup: /container=PASS/.test(output),
      expected_terminal_record_occurrences: 0,
      observed_terminal_record_occurrences: terminalRecordOccurrences,
      expected_terminal_failure_occurrences: 0,
      observed_terminal_failure_occurrences: terminalFailureOccurrences,
      expected_negative_preflight_summary_occurrences: 1,
      observed_negative_preflight_summary_occurrences: negativePreflightSummaryOccurrences,
      stdout_diagnostic_count: stdoutDiagnosticCount,
      output_sidecar_count: outputSidecarCount,
      expected_preterminal_notice_count: expectedPreterminalNoticeCount,
      diagnostic_profile: diagnosticProfile,
      terminal_source_ast: terminalSourceAst,
      terminal_mechanism: terminalMechanism
    });
  }
  // Mutated M40 stops at the first contention race. Only this exact diagnostic
  // prefix of the complete normal run can precede its finalized failure.
  const m40DiagnosticProfile = diagnosticFingerprintProfile(
    String(result.stderr ?? '').split(/\r?\n/).filter((line) =>
      expectedPostgresNotice(line)?.source === 'supabase/tests/concurrency/000_setup.sql'
    ).join('\n')
  );
  if (!m40DiagnosticProfile.safe || m40DiagnosticProfile.stderr_line_count !== 1) {
    throw new VerifierError('M40_DIAGNOSTIC_PREFIX_INVALID', 'Complete baseline did not prove the exact contention diagnostic prefix');
  }
  return {
    passed: true,
    exit_code: result.status,
    timed_out: false,
    signal: null,
    process_error: null,
    complete_verifier: !m40AcceptanceMode,
    scope: m40AcceptanceMode ? 'm40-acceptance' : 'repository-database',
    complete_scope: true,
    database_cleanup: 'PASS',
    container_cleanup: 'PASS',
    terminal_failure_not_reached: true,
    expected_terminal_record_occurrences: 0,
    observed_terminal_record_occurrences: terminalRecordOccurrences,
    expected_terminal_failure_occurrences: 0,
    observed_terminal_failure_occurrences: terminalFailureOccurrences,
    negative_preflight: {
      classification: 'foundation_security_preflight_failed_before_mutation',
      expected_process_exit: 3,
      expected_sqlstate: 'P0001',
      sanitized_summary: negativePreflightSummary,
      sanitized_summary_occurrences: negativePreflightSummaryOccurrences,
      raw_error_records_forwarded: 0,
      raw_context_records_forwarded: 0
    },
    expected_preterminal_notice_count: expectedPreterminalNoticeCount,
    observed_preterminal_notice_count: diagnosticProfile.stderr_line_count,
    unknown_diagnostic_count: diagnosticProfile.unknown_diagnostic_count + stdoutDiagnosticCount,
    stdout_diagnostic_count: stdoutDiagnosticCount,
    output_sidecar_count: outputSidecarCount,
    diagnostic_profile: diagnosticProfile,
    m40_diagnostic_profile: m40DiagnosticProfile,
    terminal_source_ast: terminalSourceAst,
    terminal_mechanism: terminalMechanism
  };
}

function transformLineEndings(bytes, eol, withBom = false) {
  const shape = textShape(bytes);
  const normalized = shape.text.replace(/\r\n/g, '\n');
  return encodeText(normalized, { hasBom: withBom, eol });
}

function makeM40Record(overrides = {}) {
  const record = {
    schema: m40SemanticSchema,
    producer: m40SemanticProducer,
    correlation: '00000000-0000-4000-8000-000000000040',
    race: 'teacher-attendance-contention-existing',
    classification: 'm40_blocking_contention',
    sql: {
      classification: 'm40_blocking_statement_timeout_v1',
      sqlstate: '57014',
      error_identifier: 'statement_timeout',
      elapsed_milliseconds: 3000,
      unauthorized_marker_observed: false
    },
    worker: { state: 'Completed', exit_code: 0, timed_out: false, signal: null, process_error: null },
    readiness: 'PASS',
    lifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS',
      rejection_codes: [],
      failure_sqlstate: null
    }
  };
  return {
    ...record,
    ...overrides,
    sql: { ...record.sql, ...(overrides.sql ?? {}) },
    worker: { ...record.worker, ...(overrides.worker ?? {}) },
    lifecycle: { ...record.lifecycle, ...(overrides.lifecycle ?? {}) }
  };
}

function semanticLine(record) {
  return `${m40SemanticPrefix}${JSON.stringify(record)}`;
}

function makeM40TerminalRecord(overrides = {}) {
  return {
    schema: m40TerminalSchema,
    producer: m40TerminalProducer,
    correlation: '00000000-0000-4000-8000-000000000040',
    outcome: m40ExpectedTermination,
    database_cleanup: 'PASS',
    container_cleanup: 'PASS',
    ...overrides
  };
}

function terminalLine(record) {
  return `${m40TerminalPrefix}${JSON.stringify(record)}`;
}

function runDatabaseClassificationControls(mutation, baselineEvidence, selectedControlIds = null) {
  const expectedRecord = makeM40Record();
  const expectedSidecar = JSON.stringify(expectedRecord);
  const expectedLine = semanticLine(expectedRecord);
  const expectedSignature = semanticSignature(expectedRecord);
  const expectedTerminal = makeM40TerminalRecord();
  const expectedTerminalLine = terminalLine(expectedTerminal);
  const cleanupPass = '[CLEANUP] database=PASS container=PASS';
  const positiveOutput = [
    m40LifecycleCandidateLine,
    m40LifecycleFinalizationLine,
    m40LifecycleSidecarLine,
    m40ExpectedTerminationLine,
    cleanupPass,
    expectedTerminalLine
  ].join('\n');
  const lowerRejected = 'M40_LOWER_CLASSIFIER_REJECTED';
  const lifecycleRejected = 'M40_LIFECYCLE_FAILURE_OBSERVED';
  const wrongSchema = makeM40Record({ schema: 'tecm.m40.semantic.v1' });
  const wrongCorrelation = makeM40Record({ correlation: '00000000-0000-4000-8000-000000000041' });
  const missingTopLevel = makeM40Record();
  delete missingTopLevel.readiness;
  const missingSqlField = makeM40Record();
  delete missingSqlField.sql.error_identifier;
  const missingWorkerField = makeM40Record();
  delete missingWorkerField.worker.timed_out;
  const missingLifecycleField = makeM40Record();
  delete missingLifecycleField.lifecycle.jobs_removed;
  const unrelated = makeM40Record({
    classification: 'unrelated_sql_error',
    sql: {
      classification: 'unexpected_sql_failure',
      sqlstate: 'P0001',
      error_identifier: 'UNRELATED_M40_SQL_PROBE',
      elapsed_milliseconds: null
    }
  });
  const unrelatedSignature = semanticSignature(unrelated);
  const unauthorized = makeM40Record({ sql: { unauthorized_marker_observed: true } });
  const unauthorizedSignature = semanticSignature(unauthorized);
  const unauthorizedRejected = makeM40Record({
    sql: { unauthorized_marker_observed: true },
    lifecycle: { rejection_codes: ['M40_UNAUTHORIZED_MARKER_OBSERVED'] }
  });
  const unauthorizedRejectedSignature = semanticSignature(unauthorizedRejected);
  const unauthorizedRejectionOutput = [
    m40LifecycleCandidateLine,
    '[M40 REJECT] M40_UNAUTHORIZED_MARKER_OBSERVED',
    cleanupPass
  ].join('\n');
  const positiveWithoutTerminal = positiveOutput.split('\n').slice(0, -1).join('\n');
  const terminalProtocolRejected = 'M40_TERMINATION_PROTOCOL_INVALID';
  const terminalContradiction = 'M40_TERMINAL_REJECTION_CONTRADICTION';
  const specs = [
    ...['rejection_codes', '\\u0072ejection_codes'].map(key => ({
      id: 'CONTROL-M40-F1-SIDECAR-' + (key === 'rejection_codes' ? 'DIRECT' : 'ESCAPED'),
      expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_JSON_INVALID'], expectedSignatures: [], expectedOccurrences: 1,
      sidecarContent: expectedSidecar.replace('"rejection_codes":[]', `"${key}":["M40_HOLDER_JOB_FAILED"],"rejection_codes":[]`), output: positiveOutput
    })),
    ...['container_cleanup', '\\u0063ontainer_cleanup'].map(key => ({
      id: 'CONTROL-M40-F1-TERMINAL-' + (key === 'container_cleanup' ? 'DIRECT' : 'ESCAPED'),
      expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_JSON_INVALID', terminalProtocolRejected],
      expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar,
      output: positiveOutput.replace('"container_cleanup":"PASS"', `"${key}":"FAIL","container_cleanup":"PASS"`)
    })),
    { id: 'CONTROL-M40-EXPECTED-SIDECAR', expectedCaught: true, expectedCodes: [], expectedSignatures: [expectedSignature], expectedOccurrences: 1, expectedTerminalFailureOccurrences: 0, expectedTerminalDiagnosticSanitized: true, sidecarContent: expectedSidecar, output: positiveOutput },
    { id: 'CONTROL-M40-TERMINAL-BEFORE-CLEANUP', expectedCaught: false, expectedLifecycleFailure: true, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_ORDER_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, expectedTerminalFailureOccurrences: 0, expectedTerminalDiagnosticSanitized: true, sidecarContent: expectedSidecar, output: [m40LifecycleCandidateLine, m40LifecycleFinalizationLine, m40LifecycleSidecarLine, m40ExpectedTerminationLine, expectedTerminalLine, cleanupPass].join('\n') },
    { id: 'CONTROL-M40-TERMINAL-SUCCESS-STATUS-ZERO', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, expectedTerminalFailureOccurrences: 0, expectedTerminalDiagnosticSanitized: true, sidecarContent: expectedSidecar, output: positiveOutput, status: 0 },
    { id: 'CONTROL-M40-THROW-TEXT-NOT-SEMANTIC-AUTHORITY', expectedCaught: false, expectedLifecycleFailure: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING', m40DiagnosticRejectionCodes.terminalErrorRecord], expectedSignatures: [], expectedOccurrences: 0, expectedTerminalFailureOccurrences: 1, expectedTerminalDiagnosticSanitized: false, output: cleanupPass, stderr: m40ExpectedTerminalFailure },
    { id: 'CONTROL-M40-R2-A-STDERR-LIFECYCLE-REJECTION', expectedCaught: false, expectedLifecycleFailure: true, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_JOB_REMOVE_FAILED', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, stderr: '[M40 REJECT] M40_JOB_REMOVE_FAILED' },
    { id: 'CONTROL-M40-R2-F-STDOUT-REJECTION', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_JOB_REMOVE_FAILED', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_JOB_REMOVE_FAILED` },
    { id: 'CONTROL-M40-R2-F-DUPLICATE-REJECTION-ACROSS-STREAMS', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_JOB_REMOVE_FAILED', 'M40_REJECTION_RECORD_DUPLICATE', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_JOB_REMOVE_FAILED`, stderr: '[M40 REJECT] M40_JOB_REMOVE_FAILED' },
    { id: 'CONTROL-M40-R2-F-DIFFERENT-REJECTIONS-ACROSS-STREAMS', expectedCaught: false, expectedCodes: ['M40_HOLDER_RELEASE_FAILED', 'M40_JOB_REMOVE_FAILED', lifecycleRejected, lowerRejected, terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_HOLDER_RELEASE_FAILED`, stderr: '[M40 REJECT] M40_JOB_REMOVE_FAILED' },
    { id: 'CONTROL-M40-R2-F-MALFORMED-REJECTION', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_REJECTION_RECORD_MALFORMED', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] malformed-code` },
    { id: 'CONTROL-M40-R2-F-UNKNOWN-REJECTION', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_REJECTION_RECORD_UNKNOWN', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_UNKNOWN_REVIEW_CODE` },
    { id: 'CONTROL-M40-R2-F-MISSING-TERMINAL', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_MISSING', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveWithoutTerminal },
    { id: 'CONTROL-M40-R2-F-DUPLICATE-TERMINAL', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_COUNT_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n${expectedTerminalLine}` },
    { id: 'CONTROL-M40-R2-F-MALFORMED-TERMINAL', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_JSON_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: replaceSourceExactly(positiveOutput, expectedTerminalLine, `${m40TerminalPrefix}{`) },
    { id: 'CONTROL-M40-R2-F-WRONG-TERMINAL-CORRELATION', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_CORRELATION_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: replaceSourceExactly(positiveOutput, expectedTerminalLine, terminalLine(makeM40TerminalRecord({ correlation: '00000000-0000-4000-8000-000000000041' }))) },
    { id: 'CONTROL-M40-R2-F-FAILURE-TERMINAL-OUTCOME', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_OUTCOME_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: replaceSourceExactly(positiveOutput, expectedTerminalLine, terminalLine(makeM40TerminalRecord({ outcome: 'M40_TERMINAL_FAILURE' }))) },
    { id: 'CONTROL-M40-R2-F-WRONG-TERMINAL-ORDER', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_RECORD_ORDER_INVALID', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: [m40LifecycleCandidateLine, m40LifecycleFinalizationLine, expectedTerminalLine, m40LifecycleSidecarLine, m40ExpectedTerminationLine, cleanupPass].join('\n') },
    { id: 'CONTROL-M40-R2-F-TERMINAL-SUCCESS-PLUS-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_TERMINAL_FINALIZATION_FAILED', terminalContradiction, terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_TERMINAL_FINALIZATION_FAILED` },
    { id: 'CONTROL-M40-R2-F-POST-SIDECAR-UNRELATED-DIAGNOSTIC', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_POST_SIDECAR_OUTPUT_INVALID', terminalProtocolRejected, m40DiagnosticRejectionCodes.unclassified], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: [m40LifecycleCandidateLine, m40LifecycleFinalizationLine, m40LifecycleSidecarLine, m40ExpectedTerminationLine, 'SQLSTATE 22023', cleanupPass, expectedTerminalLine].join('\n') },
    { id: 'CONTROL-M40-SEMANTIC-REJECTION-NOT-LIFECYCLE-FAILURE', expectedCaught: false, expectedLifecycleFailure: false, expectedCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED'], expectedSignatures: [unauthorizedRejectedSignature], expectedOccurrences: 1, sidecarContent: JSON.stringify(unauthorizedRejected), output: unauthorizedRejectionOutput },
    { id: 'CONTROL-M40-SIDECAR-MISSING', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING'], expectedSignatures: [], expectedOccurrences: 0, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-PREEXISTING', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_PREEXISTING'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, preexisting: true, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-EMPTY', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_EMPTY'], expectedSignatures: [], expectedOccurrences: 0, sidecarContent: '', output: positiveOutput },
    { id: 'CONTROL-M40-MALFORMED-SEMANTIC', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_JSON_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: '{"schema":', output: positiveOutput },
    { id: 'CONTROL-M40-INCOMPLETE-WRITE', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_JSON_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: expectedSidecar.slice(0, -1), output: positiveOutput },
    { id: 'CONTROL-M40-DUPLICATED-SEMANTIC', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_RECORD_COUNT_INVALID'], expectedSignatures: [expectedSignature, expectedSignature], expectedOccurrences: 2, sidecarContent: `${expectedSidecar}\n${expectedSidecar}`, output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-SCHEMA-VERSION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_SCHEMA_VERSION_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongSchema), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-CORRELATION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_CORRELATION_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongCorrelation), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-TOP-LEVEL-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_TOP_LEVEL_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingTopLevel), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-SQL-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_SQL_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingSqlField), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-WORKER-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_WORKER_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingWorkerField), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-LIFECYCLE-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_LIFECYCLE_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingLifecycleField), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-RACE', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_RACE_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: JSON.stringify(makeM40Record({ race: 'teacher-attendance-contention-absent' })), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-PRODUCER', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_PRODUCER_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(makeM40Record({ producer: 'sql-worker/forged-producer' })), output: positiveOutput },
    { id: 'CONTROL-M40-EXPECTED-PLUS-UNRELATED', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_RECORD_COUNT_INVALID', 'M40_UNRELATED_SQL_FAILURE'], expectedSignatures: [expectedSignature, unrelatedSignature].sort(), expectedOccurrences: 2, sidecarContent: `${expectedSidecar}\n${JSON.stringify(unrelated)}`, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-OVERSIZED', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_OVERSIZED'], expectedSignatures: [], expectedOccurrences: 0, sidecarContent: 'x'.repeat(m40SidecarMaximumBytes + 1), output: positiveOutput },
    { id: 'CONTROL-M40-RECORD-ONLY-IN-STDOUT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING', m40DiagnosticRejectionCodes.sidecarPayload, 'M40_UNAUTHORIZED_PROCESS_OUTPUT'], expectedSignatures: [], expectedOccurrences: 0, output: `${expectedLine}\n${positiveOutput}` },
    { id: 'CONTROL-M40-VALID-SIDECAR-UNAUTHORIZED-STDOUT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', m40DiagnosticRejectionCodes.sidecarPayload, 'M40_UNAUTHORIZED_PROCESS_OUTPUT'], expectedSignatures: [unauthorizedSignature], expectedOccurrences: 1, sidecarContent: JSON.stringify(unauthorized), output: `${expectedLine}\n${positiveOutput}` },
    { id: 'CONTROL-M40-SIDECAR-WRITE-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_SIDECAR_MISSING', 'M40_SIDECAR_WRITE_FAILED'], expectedSignatures: [], expectedOccurrences: 0, output: `${m40LifecycleCandidateLine}\n${m40LifecycleFinalizationLine}\n[M40 REJECT] M40_SIDECAR_WRITE_FAILED\n${cleanupPass}` },
    { id: 'CONTROL-M40-SIDECAR-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_SIDECAR_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, sidecarCleanup: 'FAIL', output: positiveOutput },
    { id: 'CONTROL-M40-STALE-OTHER-EXECUTION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_CORRELATION_INVALID', 'M40_SIDECAR_STALE'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongCorrelation), stale: true, output: positiveOutput },
    { id: 'CONTROL-M40-LATE-SIDECAR', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_LATE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, late: true, output: positiveOutput },
    { id: 'CONTROL-M40-EXPECTED-FREE-TEXT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING'], expectedSignatures: [], expectedOccurrences: 0, output: `M40 bounded contention classification missing\n${cleanupPass}` },
    { id: 'CONTROL-M40-STATUS-ZERO', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: 0 },
    { id: 'CONTROL-M40-TIMEOUT', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_STATUS_INVALID', 'M40_PROCESS_TIMEOUT'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, error: { code: 'ETIMEDOUT', message: 'timed out' } },
    { id: 'CONTROL-M40-SIGNAL', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_SIGNAL', 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, signal: 'SIGTERM' },
    { id: 'CONTROL-M40-PROCESS-ERROR', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_ERROR', 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, error: { code: 'ENOENT', message: 'spawn failed' } },
    { id: 'CONTROL-M40-DATABASE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_DATABASE_CLEANUP_FAILED', lifecycleRejected, lowerRejected, 'M40_TERMINAL_CLEANUP_CONTRADICTION', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: replaceSourceExactly(positiveOutput, cleanupPass, '[CLEANUP] database=FAIL container=PASS') },
    { id: 'CONTROL-M40-CONTAINER-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_CONTAINER_CLEANUP_FAILED', lifecycleRejected, lowerRejected, 'M40_TERMINAL_CLEANUP_CONTRADICTION', terminalProtocolRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: replaceSourceExactly(positiveOutput, cleanupPass, '[CLEANUP] database=PASS container=FAIL') },
    { id: 'CONTROL-M40-LIFECYCLE-VALID-RECORD', expectedCaught: false, expectedLifecycleFailure: true, expectedCodes: [lifecycleRejected, lowerRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `Docker Desktop is not available\n${positiveOutput}` },
    { id: 'CONTROL-M40-UNEXPECTED-POST-SIDECAR-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, terminalContradiction, terminalProtocolRejected, 'M40_UNEXPECTED_POST_SIDECAR_FAILURE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_UNEXPECTED_POST_SIDECAR_FAILURE` },
    { id: 'CONTROL-M40-SOURCE-RESTORATION-FAILURE', expectedCaught: false, expectedCodes: ['M40_SOURCE_RESTORATION_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, sourceRestoration: 'FAIL' },
    { id: 'CONTROL-M40-WORKTREE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_WORKTREE_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, worktreeCleanup: 'FAIL' },
    { id: 'CONTROL-M40-WORKSPACE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_WORKSPACE_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, workspaceCleanup: 'FAIL' },
    { id: 'CONTROL-M40-BASELINE-FAILURE', expectedCaught: false, expectedCodes: ['M40_BASELINE_INCOMPLETE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, baselinePassed: false },
    { id: 'CONTROL-M40-INCOMPLETE-VERIFIER', expectedCaught: false, expectedCodes: ['M40_COMPLETE_VERIFIER_NOT_RUN'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, completeNoArgumentVerifierRan: false }
  ];
  const requestedControlIds = selectedControlIds === null ? null : new Set(selectedControlIds);
  if (requestedControlIds && requestedControlIds.size !== selectedControlIds.length) {
    throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_INVALID', 'selected classification controls must be duplicate-free');
  }
  const selectedSpecs = requestedControlIds
    ? specs.filter(({ id }) => requestedControlIds.has(id))
    : specs;
  if (requestedControlIds && selectedSpecs.length !== requestedControlIds.size) {
    throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_INVALID', 'selected classification controls must all exist');
  }
  return selectedSpecs.map((spec) => {
    const uniqueExpectedCodes = new Set(spec.expectedCodes);
    if ((!spec.expectedCaught && spec.expectedCodes.length === 0)
        || uniqueExpectedCodes.size !== spec.expectedCodes.length) {
      throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_INVALID', `${spec.id} must define expected rejection codes`);
    }
    const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-m40-classifier-${spec.id.toLowerCase()}-`));
    const target = resolve(tempRoot, 'classifier-control.txt');
    const sidecar = resolve(tempRoot, 'semantic-record.json');
    const sentinel = `UNIQUE_${spec.id}_TARGET`;
    const original = Buffer.from(`${sentinel}\n`, 'utf8');
    let restored = false;
    let cleaned = false;
    let classification;
    let observed;
    try {
      writeFileSync(target, original);
      const mutated = mutateBytes(original, { id: spec.id, search: sentinel, replacement: `${sentinel}_MUTATED` });
      writeFileSync(target, mutated.bytes);
      const now = Date.now();
      if (spec.sidecarContent !== undefined) writeFileSync(sidecar, spec.sidecarContent);
      let startedAt = now - 2_000;
      let finishedAt = now + 2_000;
      if (spec.stale) {
        const staleTime = new Date(now - 10_000);
        utimesSync(sidecar, staleTime, staleTime);
        startedAt = now - 5_000;
      }
      if (spec.late) {
        startedAt = now - 10_000;
        finishedAt = now - 5_000;
      }
      const sidecarObservation = inspectM40Sidecar({
        path: sidecar,
        expectedCorrelation: expectedRecord.correlation,
        preexisting: spec.preexisting ?? false,
        startedAt,
        finishedAt,
        cleanup: spec.sidecarCleanup ?? 'PASS'
      });
      sidecarObservation.expected_correlation = expectedRecord.correlation;
      classification = databaseFailureClassification({
        status: spec.status === undefined ? 1 : spec.status,
        signal: spec.signal ?? null,
        error: spec.error,
        stdout: spec.output,
        stderr: spec.stderr ?? '',
        m40_sidecar: sidecarObservation
      }, mutation);
      observed = evaluateM40Caught({
        baselinePassed: spec.baselinePassed ?? baselineEvidence.passed,
        mutationMatches: mutated.matches,
        intendedMutationApplied: spec.intendedMutationApplied ?? true,
        completeNoArgumentVerifierRan: spec.completeNoArgumentVerifierRan ?? true,
        classification,
        sourceRestoration: spec.sourceRestoration ?? 'PASS',
        worktreeCleanup: spec.worktreeCleanup ?? 'PASS',
        workspaceCleanup: spec.workspaceCleanup ?? 'PASS'
      });
      writeFileSync(target, original);
      restored = readFileSync(target).equals(original);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      cleaned = !existsSync(tempRoot);
    }
    const signaturesMatch = classification.semantic_signatures.length === spec.expectedSignatures.length
      && classification.semantic_signatures.every((value, index) => value === spec.expectedSignatures[index]);
    const expectedOccurrences = spec.expectedOccurrences;
    const occurrencesMatch = classification.semantic_occurrence_count === expectedOccurrences;
    const lifecycleMatches = spec.expectedLifecycleFailure === undefined
      || classification.lifecycle_failure === spec.expectedLifecycleFailure;
    const terminalFailureOccurrencesMatch = spec.expectedTerminalFailureOccurrences === undefined
      || classification.terminal_failure_sentinel.total_occurrences === spec.expectedTerminalFailureOccurrences;
    const terminalDiagnosticSanitizationMatches = spec.expectedTerminalDiagnosticSanitized === undefined
      || classification.terminal_failure_sentinel.terminal_diagnostic_sanitized === spec.expectedTerminalDiagnosticSanitized;
    const expectedCodes = [...spec.expectedCodes].sort();
    const codesMatch = observed.rejection_codes.length === expectedCodes.length
      && observed.rejection_codes.every((value, index) => value === expectedCodes[index]);
    if (observed.caught !== spec.expectedCaught || !codesMatch || !signaturesMatch || !lifecycleMatches
        || !terminalFailureOccurrencesMatch || !terminalDiagnosticSanitizationMatches
        || !occurrencesMatch || !restored || !cleaned) {
      throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_FAILED', `${spec.id} did not fail closed`, {
        control: spec.id,
        expected_caught: spec.expectedCaught,
        observed_caught: observed.caught,
        expected_rejection_codes: expectedCodes,
        observed_rejection_codes: observed.rejection_codes,
        expected_semantic_classifications: spec.expectedSignatures,
        observed_semantic_classifications: classification.semantic_signatures,
        expected_occurrences: expectedOccurrences,
        observed_occurrences: classification.semantic_occurrence_count,
        expected_lifecycle_failure: spec.expectedLifecycleFailure ?? null,
        observed_lifecycle_failure: classification.lifecycle_failure,
        expected_terminal_failure_occurrences: spec.expectedTerminalFailureOccurrences ?? null,
        observed_terminal_failure_occurrences: classification.terminal_failure_sentinel.total_occurrences,
        expected_terminal_diagnostic_sanitized: spec.expectedTerminalDiagnosticSanitized ?? null,
        observed_terminal_diagnostic_sanitized: classification.terminal_failure_sentinel.terminal_diagnostic_sanitized,
        classification,
        restoration: restored ? 'PASS' : 'FAIL',
        cleanup: cleaned ? 'PASS' : 'FAIL'
      });
    }
    return {
      id: spec.id,
      expected_caught: spec.expectedCaught,
      observed_caught: observed.caught,
      expected_rejection_codes: expectedCodes,
      observed_rejection_codes: observed.rejection_codes,
      expected_classifications: spec.expectedSignatures,
      observed_classifications: classification.semantic_signatures,
      expected_occurrences: expectedOccurrences,
      observed_occurrences: classification.semantic_occurrence_count,
      expected_lifecycle_failure: spec.expectedLifecycleFailure ?? null,
      observed_lifecycle_failure: classification.lifecycle_failure,
      expected_terminal_failure_occurrences: spec.expectedTerminalFailureOccurrences ?? null,
      observed_terminal_failure_occurrences: classification.terminal_failure_sentinel.total_occurrences,
      expected_terminal_diagnostic_sanitized: spec.expectedTerminalDiagnosticSanitized ?? null,
      observed_terminal_diagnostic_sanitized: classification.terminal_failure_sentinel.terminal_diagnostic_sanitized,
      contract_override: {
        baseline_passed: spec.baselinePassed ?? baselineEvidence.passed,
        intended_mutation_applied: spec.intendedMutationApplied ?? true,
        complete_no_argument_verifier_ran: spec.completeNoArgumentVerifierRan ?? true,
        source_restoration: spec.sourceRestoration ?? 'PASS',
        worktree_cleanup: spec.worktreeCleanup ?? 'PASS',
        workspace_cleanup: spec.workspaceCleanup ?? 'PASS'
      },
      restoration: 'PASS',
      cleanup: 'PASS',
      result: 'PASS'
    };
  });
}

function runPowerShellDiagnosticTerminationControl({ id, replacement, expectedCodes, fileEntrypoint = false }) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-m40-diagnostic-${id.toLowerCase()}-`));
  const target = resolve(tempRoot, 'termination-control.ps1');
  const original = Buffer.from('exit 0\n', 'utf8');
  const emptyProfile = diagnosticFingerprintProfile('');
  let mutation = null;
  let result = null;
  let classification = null;
  let restored = false;
  let cleaned = false;
  try {
    writeFileSync(target, original);
    mutation = mutateBytes(original, { id, search: 'exit 0', replacement });
    writeFileSync(target, mutation.bytes);
    const candidateSource = new TextDecoder('utf-8', { fatal: true }).decode(mutation.bytes);
    const args = fileEntrypoint
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', target]
      : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', candidateSource];
    result = spawnSync('pwsh', args, {
      cwd: tempRoot,
      encoding: 'utf8',
      env: databaseProbeEnvironment(),
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 256 * 1024
    });
    classification = classifyM40DiagnosticSafety(result, emptyProfile);
    writeFileSync(target, original);
    restored = readFileSync(target).equals(original);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
  }
  const observedCodes = classification?.rejection_codes ?? ['M40_DIAGNOSTIC_CONTROL_NOT_CLASSIFIED'];
  const exactRejectionSet = exactSortedSet(observedCodes, expectedCodes);
  const processContract = result?.status === 1 && !result.error && !result.signal
    && String(result.stdout ?? '').length === 0;
  if (!mutation || mutation.matches !== 1 || mutation.bytes.equals(original)
      || !exactRejectionSet || !processContract || !restored || !cleaned) {
    throw new VerifierError('M40_DIAGNOSTIC_CONTROL_FAILED', `${id} did not satisfy its exact termination contract`, {
      control: id,
      expected_rejection_codes: [...expectedCodes].sort(),
      observed_rejection_codes: [...observedCodes].sort(),
      exact_rejection_set: exactRejectionSet,
      candidate_changed: mutation ? !mutation.bytes.equals(original) : false,
      mutation_target_count: mutation?.matches ?? null,
      exit_code: result?.status ?? null,
      signal: result?.signal ?? null,
      process_error_code: result?.error?.code ?? null,
      stdout_bytes: Buffer.byteLength(String(result?.stdout ?? '')),
      stderr_bytes: Buffer.byteLength(String(result?.stderr ?? '')),
      diagnostic_classification: classification,
      restoration: restored ? 'PASS' : 'FAIL',
      cleanup: cleaned ? 'PASS' : 'FAIL'
    });
  }
  return {
    id,
    expected_rejection_codes: [...expectedCodes].sort(),
    observed_rejection_codes: [...observedCodes].sort(),
    exact_rejection_set: true,
    expected_set_duplicate_free: new Set(expectedCodes).size === expectedCodes.length,
    observed_set_duplicate_free: new Set(observedCodes).size === observedCodes.length,
    candidate_changed: true,
    mutation_target_count: mutation.matches,
    entrypoint: fileEntrypoint ? 'PowerShell -File' : 'PowerShell -Command negative control',
    exit_code: result.status,
    signal: null,
    process_error: null,
    stdout_bytes: Buffer.byteLength(String(result.stdout ?? '')),
    stderr_bytes: Buffer.byteLength(String(result.stderr ?? '')),
    diagnostic_classification: classification,
    restoration: 'PASS',
    cleanup: 'PASS',
    result: 'PASS'
  };
}

function runNegativePreflightProducerControls(baselineEvidence = null) {
  const databaseSourcePath = resolve(repoRoot, databaseVerifierPath);
  const sourceBefore = readFileSync(databaseSourcePath);
  const producerControlScript = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  $env:TECM_NEGATIVE_PREFLIGHT_SOURCE,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) { throw 'Negative preflight source did not parse.' }
foreach ($functionName in @('Invoke-NegativePreflightProcess','Get-NegativePreflightAssessment')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq $functionName
  }, $true))
  if ($definitions.Count -ne 1) { throw 'Negative preflight production helper ownership is invalid.' }
  . ([ScriptBlock]::Create($definitions[0].Extent.Text))
}

function Copy-NegativePreflightResult {
  param([Parameter(Mandatory)][object]$Result)
  [pscustomobject]@{
    Phase = $Result.Phase
    ExitCode = $Result.ExitCode
    TimedOut = $Result.TimedOut
    Signal = $Result.Signal
    ProcessError = $Result.ProcessError
    Stdout = $Result.Stdout
    Stderr = $Result.Stderr
  }
}

function Test-NegativePreflightControl {
  param(
    [Parameter(Mandatory)][string]$Id,
    [Parameter(Mandatory)][object]$Candidate,
    [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$ExpectedCodes,
    [Parameter(Mandatory)][bool]$Negative
  )
  $assessment = Get-NegativePreflightAssessment -Result $Candidate
  [string[]]$expected = @($ExpectedCodes | Sort-Object)
  [string[]]$observed = @($assessment.RejectionCodes | Sort-Object)
  $expectedDuplicateFree = @($expected | Select-Object -Unique).Count -eq $expected.Count
  $observedDuplicateFree = @($observed | Select-Object -Unique).Count -eq $observed.Count
  $sameValues = $expected.Count -eq $observed.Count
  if ($sameValues) {
    for ($index = 0; $index -lt $expected.Count; $index++) {
      if ($expected[$index] -cne $observed[$index]) { $sameValues = $false; break }
    }
  }
  $exact = $expectedDuplicateFree -and $observedDuplicateFree -and $sameValues
  [pscustomobject]@{
    id = $Id
    negative_control = $Negative
    expected_rejection_codes = $expected
    observed_rejection_codes = $observed
    exact_rejection_set = $exact
    expected_set_non_empty = (-not $Negative) -or $expected.Count -gt 0
    expected_set_duplicate_free = $expectedDuplicateFree
    observed_set_duplicate_free = $observedDuplicateFree
    candidate_changed = $true
    mutation_target_count = 1
    accepted = $assessment.Accepted
    classification = $assessment.Classification
    sqlstate = $assessment.SqlState
    semantic_identifier = $assessment.SemanticIdentifier
    error_count = $assessment.ErrorCount
    context_count = $assessment.ContextCount
    location_count = $assessment.LocationCount
    diagnostic_record_count = $assessment.DiagnosticRecordCount
    restoration = 'PASS'
    cleanup = 'PASS'
    result = if ($exact -and ((-not $Negative -and $assessment.Accepted) -or ($Negative -and -not $assessment.Accepted))) { 'PASS' } else { 'FAIL' }
  }
}

$expectedError = 'psql:/workspace/supabase/migrations/202607180005_foundation_security.sql:48: ERROR:  P0001: foundation security preflight failed before mutation: {"unsafe_parent_links": 10, "unsafe_notifications": 0, "leave_normalization_collisions": 0}'
$expectedContext = 'CONTEXT:  PL/pgSQL function inline_code_block line 34 at RAISE'
$expectedLocation = 'LOCATION:  exec_stmt_raise, pl_exec.c:3905'
$childSource = "[Console]::Error.WriteLine('$expectedError'); [Console]::Error.WriteLine('$expectedContext'); [Console]::Error.WriteLine('$expectedLocation'); exit 3"
$encodedChild = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childSource))
$pwshPath = (Get-Process -Id $PID).Path
$baseline = Invoke-NegativePreflightProcess -FilePath $pwshPath -Arguments @(
  '-NoProfile','-NonInteractive','-EncodedCommand',$encodedChild
) -Phase 'negative_preflight' -TimeoutSeconds 10
$baselineLines = @($baseline.Stderr -split '\r?\n' | Where-Object { $_.Length -gt 0 })
if ($baselineLines.Count -ne 3) { throw 'Negative preflight capture fixture shape is invalid.' }

$controls = @()
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-01-EXACT-EXPECTED-PRODUCER' -Candidate $baseline -ExpectedCodes @() -Negative $false

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = $candidate.Stderr.Replace('P0001:', '22023:')
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-02-WRONG-SQLSTATE' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_SQLSTATE_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = $candidate.Stderr.Replace('foundation security preflight failed before mutation', 'foundation security preflight rejected')
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-03-WRONG-SEMANTIC-IDENTIFIER' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_SEMANTIC_IDENTIFIER_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-04-ERROR-WITHOUT-CONTEXT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_CONTEXT_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[1],$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-05-CONTEXT-WITHOUT-ERROR' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_ERROR_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],$baselineLines[2],$baselineLines[0]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-06-EXTRA-ERROR' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_ERROR_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],$baselineLines[2],$baselineLines[1]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-07-EXTRA-CONTEXT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_CONTEXT_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[1],$baselineLines[0],$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-08-REVERSED-ORDER' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_ORDER_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Phase = 'post_candidate'
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-09-WRONG-PHASE' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_PHASE_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],($baselineLines[2] + ' credential=CONTROL_ONLY')) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-10-CREDENTIAL-LIKE' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID','NEGATIVE_PREFLIGHT_SENSITIVE_DIAGNOSTIC') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$privateFixture = 'C:' + [char]92 + 'Users' + [char]92 + 'private-user' + [char]92 + 'fixture.sql'
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],($baselineLines[2] + ' source=' + $privateFixture)) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-11-PRIVATE-PATH' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID','NEGATIVE_PREFLIGHT_PRIVATE_PATH_DIAGNOSTIC') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.TimedOut = $true
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12A-TIMEOUT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_PROCESS_LIFECYCLE_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Signal = 'SIGTERM'
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12B-SIGNAL' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_PROCESS_LIFECYCLE_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.ProcessError = 'negative_preflight_process_error'
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12C-PROCESS-ERROR' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_PROCESS_LIFECYCLE_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.ExitCode = 1
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12D-WRONG-PROCESS-EXIT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_PROCESS_EXIT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],$baselineLines[2],'UNEXPECTED_DIAGNOSTIC_RECORD') -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12E-EXTRA-DIAGNOSTIC' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stdout = 'UNEXPECTED_CHILD_STDOUT'
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12F-CHILD-STDOUT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_STDOUT_NOT_EMPTY') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12G-MISSING-LOCATION' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true

$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],($baselineLines[1] + ' altered'),$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-12H-CONTEXT-STRUCTURE' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID') -Negative $true

foreach ($style in @('LF','CRLF')) {
  $candidate = Copy-NegativePreflightResult $baseline
  $separator = if ($style -eq 'LF') { [string][char]10 } else { [string][char]13+[char]10 }
  $candidate.Stderr = ($baselineLines -join $separator) + $separator
  $controls += Test-NegativePreflightControl -Id "CONTROL-NEGATIVE-PREFLIGHT-EOL-$style" -Candidate $candidate -ExpectedCodes @() -Negative $false
}

$variants = @(
  @{ Id='MISSING-SQLSTATE'; Search='P0001: '; Replacement=''; Codes=@('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID') },
  @{ Id='MISSING-IDENTIFIER'; Search='foundation security preflight failed before mutation: '; Replacement=''; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_IDENTIFIER_INVALID') },
  @{ Id='OLD-ONE-LINK-ASSUMPTION'; Search='"unsafe_parent_links": 10'; Replacement='"unsafe_parent_links": 1'; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID') },
  @{ Id='DUPLICATE-JSON-KEY'; Search='{"unsafe_parent_links": 10'; Replacement='{"unsafe_parent_links": 10, "unsafe_parent_links": 10'; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID') },
  @{ Id='EXTRA-JSON-KEY'; Search='{"unsafe_parent_links": 10'; Replacement='{"extra": 0, "unsafe_parent_links": 10'; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID') },
  @{ Id='STRING-JSON-NUMBER'; Search='"unsafe_parent_links": 10'; Replacement='"unsafe_parent_links": "10"'; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID') },
  @{ Id='MISSING-JSON-KEY'; Search='"unsafe_notifications": 0, '; Replacement=''; Codes=@('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID') },
  @{ Id='NUL'; Search='LOCATION:'; Replacement=([string][char]0+'LOCATION:'); Codes=@('NEGATIVE_PREFLIGHT_DIAGNOSTIC_CHARACTERS_INVALID','NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID') },
  @{ Id='ANSI'; Search='LOCATION:'; Replacement=([string][char]27+'[31mLOCATION:'); Codes=@('NEGATIVE_PREFLIGHT_DIAGNOSTIC_CHARACTERS_INVALID','NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID') },
  @{ Id='OVERSIZED'; Search='LOCATION:'; Replacement=('x'*16385+'LOCATION:'); Codes=@('NEGATIVE_PREFLIGHT_DIAGNOSTIC_BOUNDS_INVALID','NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID') }
)
foreach ($variant in $variants) {
  $candidate = Copy-NegativePreflightResult $baseline
  if ([regex]::Matches($candidate.Stderr,[regex]::Escape($variant.Search)).Count -ne 1) { throw 'Producer control target was not exact-one' }
  $candidate.Stderr = $candidate.Stderr.Replace($variant.Search,$variant.Replacement)
  $controls += Test-NegativePreflightControl -Id ('CONTROL-NEGATIVE-PREFLIGHT-'+$variant.Id) -Candidate $candidate -ExpectedCodes $variant.Codes -Negative $true
}
$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],$baselineLines[1],$baselineLines[2],$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-DUPLICATE-LOCATION' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID','NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true
$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = @($baselineLines[0],'',$baselineLines[1],$baselineLines[2]) -join [Environment]::NewLine
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-EXTRA-BLANK-FRAME' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID') -Negative $true
$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stderr = $baselineLines[0]+[char]13+[char]10+$baselineLines[1]+[char]10+$baselineLines[2]+[char]10
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-MIXED-EOL' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_DIAGNOSTIC_NEWLINES_INVALID') -Negative $true
$candidate = Copy-NegativePreflightResult $baseline
$candidate.Stdout = '{"schema":"tecm.m40.semantic.v2","classification":"m40_blocking_contention"}'
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-FORGED-STRUCTURED-STDOUT' -Candidate $candidate -ExpectedCodes @('NEGATIVE_PREFLIGHT_STDOUT_NOT_EMPTY') -Negative $true

$captureFailureCodes = @(
  'NEGATIVE_PREFLIGHT_PROCESS_EXIT_INVALID','NEGATIVE_PREFLIGHT_PROCESS_LIFECYCLE_INVALID',
  'NEGATIVE_PREFLIGHT_DIAGNOSTIC_BOUNDS_INVALID','NEGATIVE_PREFLIGHT_ERROR_COUNT_INVALID',
  'NEGATIVE_PREFLIGHT_CONTEXT_COUNT_INVALID','NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID',
  'NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID'
)
$captureVariants = @(
  @{ Id='INVALID-UTF8-PROCESS'; Source='[Console]::OpenStandardError().Write([byte[]]@(195,40),0,2); exit 3'; Timeout=10; Error='negative_preflight_encoding_invalid' },
  @{ Id='OVERSIZED-PROCESS'; Source='[Console]::Error.Write(("x"*16385)); exit 3'; Timeout=10; Error='negative_preflight_output_oversized' },
  @{ Id='ACTUAL-TIMEOUT'; Source='Start-Sleep -Seconds 10; exit 3'; Timeout=1; Error='negative_preflight_process_timeout' }
)
foreach ($variant in $captureVariants) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($variant.Source))
  $candidate = Invoke-NegativePreflightProcess -FilePath $pwshPath -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -Phase 'negative_preflight' -TimeoutSeconds $variant.Timeout
  if ($candidate.ProcessError -cne $variant.Error) { throw 'Producer capture control did not execute its intended failure' }
  $controls += Test-NegativePreflightControl -Id ('CONTROL-NEGATIVE-PREFLIGHT-'+$variant.Id) -Candidate $candidate -ExpectedCodes $captureFailureCodes -Negative $true
}
$candidate = Invoke-NegativePreflightProcess -FilePath 'tecm-negative-preflight-missing-executable' -Arguments @('probe') -Phase 'negative_preflight' -TimeoutSeconds 1
if ($candidate.ProcessError -cne 'negative_preflight_process_error') { throw 'Producer spawn control did not execute its intended failure' }
$controls += Test-NegativePreflightControl -Id 'CONTROL-NEGATIVE-PREFLIGHT-ACTUAL-SPAWN-ERROR' -Candidate $candidate -ExpectedCodes $captureFailureCodes -Negative $true

$failedControls = @($controls | Where-Object {
  $_.result -ne 'PASS' -or -not $_.exact_rejection_set -or
    -not $_.expected_set_duplicate_free -or -not $_.observed_set_duplicate_free -or
    ($_.negative_control -and -not $_.expected_set_non_empty)
})
$controls | ConvertTo-Json -Compress -Depth 6
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', producerControlScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, TECM_NEGATIVE_PREFLIGHT_SOURCE: databaseSourcePath },
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  const sourceRestored = readFileSync(databaseSourcePath).equals(sourceBefore);
  if (result.status !== 0 || result.error || result.signal || !sourceRestored) {
    throw new VerifierError('NEGATIVE_PREFLIGHT_PRODUCER_CONTROLS_FAILED', 'Production negative-preflight helper controls did not complete safely', {
      exit_code: result.status,
      timed_out: result.error?.code === 'ETIMEDOUT',
      signal: result.signal ?? null,
      process_error_code: result.error?.code ?? null,
      stdout_bytes: Buffer.byteLength(String(result.stdout ?? '')),
      stderr_bytes: Buffer.byteLength(String(result.stderr ?? '')),
      source_restoration: sourceRestored ? 'PASS' : 'FAIL'
    });
  }
  let controls;
  try {
    controls = JSON.parse(String(result.stdout).trim());
  } catch {
    throw new VerifierError('NEGATIVE_PREFLIGHT_CONTROL_EVIDENCE_INVALID', 'Negative-preflight controls did not emit one sanitized JSON record', {
      stdout_bytes: Buffer.byteLength(String(result.stdout ?? '')),
      stderr_bytes: Buffer.byteLength(String(result.stderr ?? ''))
    });
  }
  if (!Array.isArray(controls)) controls = [controls];
  const rawDiagnosticFragments = [
    'foundation security preflight failed before mutation:',
    'psql:/workspace/supabase/migrations/202607180005_foundation_security.sql',
    'CONTEXT:',
    'LOCATION:'
  ];
  const outerOutput = outputOf(result);
  const rawDiagnosticOccurrences = rawDiagnosticFragments
    .reduce((count, fragment) => count + countOccurrences(outerOutput, fragment), 0);
  const invalidControls = controls.filter((control) => (
    control.result !== 'PASS'
    || control.exact_rejection_set !== true
    || control.expected_set_duplicate_free !== true
    || control.observed_set_duplicate_free !== true
    || control.candidate_changed !== true
    || control.mutation_target_count !== 1
    || control.restoration !== 'PASS'
    || control.cleanup !== 'PASS'
    || (control.negative_control === true && (
      control.expected_set_non_empty !== true
      || !Array.isArray(control.expected_rejection_codes)
      || control.expected_rejection_codes.length === 0
    ))
  ));
  if (controls.length < 18 || invalidControls.length > 0 || rawDiagnosticOccurrences !== 0
      || Buffer.byteLength(String(result.stderr ?? '')) !== 0) {
    throw new VerifierError('NEGATIVE_PREFLIGHT_CONTROL_CONTRACT_FAILED', 'Negative-preflight controls violated exact-set or output-sanitization requirements', {
      control_count: controls.length,
      invalid_controls: invalidControls.map(({ id, expected_rejection_codes, observed_rejection_codes }) =>
        ({ id, expected_rejection_codes, observed_rejection_codes })),
      raw_diagnostic_occurrences_in_outer_output: rawDiagnosticOccurrences,
      outer_stderr_bytes: Buffer.byteLength(String(result.stderr ?? ''))
    });
  }

  const producerSuppression = {
    id: 'CONTROL-NEGATIVE-PREFLIGHT-13-PRODUCER-OUTPUT-SUPPRESSED',
    negative_control: false,
    expected_rejection_codes: [],
    observed_rejection_codes: [],
    exact_rejection_set: true,
    expected_set_non_empty: true,
    expected_set_duplicate_free: true,
    observed_set_duplicate_free: true,
    candidate_changed: true,
    mutation_target_count: 1,
    raw_diagnostic_occurrences_in_outer_stdout_stderr: rawDiagnosticOccurrences,
    outer_stderr_bytes: 0,
    source_restoration: 'PASS',
    cleanup: 'PASS',
    result: 'PASS'
  };
  if (!baselineEvidence) {
    return { controls: [...controls, producerSuppression], control_count: controls.length + 1,
      negative_control_count: controls.filter(({ negative_control: negative }) => negative === true).length,
      source_sha256: sha256(sourceBefore), result: 'PASS' };
  }
  const baselineProfile = baselineEvidence.diagnostic_profile;
  const baselineControl = {
    id: 'CONTROL-NEGATIVE-PREFLIGHT-14-COMPLETE-BASELINE-SANITIZED',
    negative_control: false,
    expected_rejection_codes: [],
    observed_rejection_codes: baselineProfile.rejection_codes,
    exact_rejection_set: exactSortedSet(baselineProfile.rejection_codes, []),
    expected_set_non_empty: true,
    expected_set_duplicate_free: true,
    observed_set_duplicate_free: new Set(baselineProfile.rejection_codes).size === baselineProfile.rejection_codes.length,
    candidate_changed: true,
    mutation_target_count: 1,
    expected_notice_count: expectedPreterminalNoticeCount,
    observed_notice_count: baselineEvidence.observed_preterminal_notice_count,
    sanitized_summary_occurrences: baselineEvidence.negative_preflight.sanitized_summary_occurrences,
    raw_error_records_forwarded: baselineEvidence.negative_preflight.raw_error_records_forwarded,
    raw_context_records_forwarded: baselineEvidence.negative_preflight.raw_context_records_forwarded,
    unknown_diagnostic_count: baselineEvidence.unknown_diagnostic_count,
    restoration: 'PASS',
    cleanup: 'PASS',
    result: 'PASS'
  };
  if (!baselineControl.exact_rejection_set
      || baselineControl.observed_notice_count !== expectedPreterminalNoticeCount
      || baselineControl.sanitized_summary_occurrences !== 1
      || baselineControl.raw_error_records_forwarded !== 0
      || baselineControl.raw_context_records_forwarded !== 0
      || baselineControl.unknown_diagnostic_count !== 0) {
    throw new VerifierError('NEGATIVE_PREFLIGHT_BASELINE_CONTROL_FAILED', 'Complete baseline did not prove sanitized negative-preflight attribution', {
      baseline_control: baselineControl
    });
  }
  return {
    expected_process_exit: 3,
    expected_sqlstate: 'P0001',
    expected_semantic_identifier: 'foundation_security_preflight_failed_before_mutation',
    controls: [...controls, producerSuppression, baselineControl],
    control_count: controls.length + 2,
    negative_control_count: controls.filter(({ negative_control: negative }) => negative === true).length,
    result: 'PASS'
  };
}

function runDiagnosticFixtureControl({
  id,
  baselineProfile,
  stdout = '',
  stderr,
  expectedCodes,
  assertClassification = () => true
}) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-m40-diagnostic-fixture-${id.toLowerCase()}-`));
  const target = resolve(tempRoot, 'diagnostic-control.txt');
  const sentinel = `UNIQUE_${id}_TARGET`;
  const original = Buffer.from(`${sentinel}\n`, 'utf8');
  let mutation = null;
  let classification = null;
  let restored = false;
  let cleaned = false;
  try {
    writeFileSync(target, original);
    mutation = mutateBytes(original, { id, search: sentinel, replacement: `${sentinel}_MUTATED` });
    writeFileSync(target, mutation.bytes);
    classification = classifyM40DiagnosticSafety({ status: 1, signal: null, stdout, stderr }, baselineProfile);
    writeFileSync(target, original);
    restored = readFileSync(target).equals(original);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
  }
  const observedCodes = classification?.rejection_codes ?? ['M40_DIAGNOSTIC_CONTROL_NOT_CLASSIFIED'];
  const exactRejectionSet = exactSortedSet(observedCodes, expectedCodes);
  if (!mutation || mutation.matches !== 1 || mutation.bytes.equals(original)
      || !exactRejectionSet || !assertClassification(classification) || !restored || !cleaned) {
    throw new VerifierError('M40_DIAGNOSTIC_CONTROL_FAILED', `${id} did not satisfy its exact diagnostic contract`, {
      control: id,
      expected_rejection_codes: [...expectedCodes].sort(),
      observed_rejection_codes: [...observedCodes].sort(),
      exact_rejection_set: exactRejectionSet,
      candidate_changed: mutation ? !mutation.bytes.equals(original) : false,
      mutation_target_count: mutation?.matches ?? null,
      diagnostic_classification: classification,
      restoration: restored ? 'PASS' : 'FAIL',
      cleanup: cleaned ? 'PASS' : 'FAIL'
    });
  }
  return {
    id,
    expected_rejection_codes: [...expectedCodes].sort(),
    observed_rejection_codes: [...observedCodes].sort(),
    exact_rejection_set: true,
    expected_set_duplicate_free: new Set(expectedCodes).size === expectedCodes.length,
    observed_set_duplicate_free: new Set(observedCodes).size === observedCodes.length,
    candidate_changed: true,
    mutation_target_count: mutation.matches,
    diagnostic_classification: classification,
    restoration: 'PASS',
    cleanup: 'PASS',
    result: 'PASS'
  };
}

function runM40DiagnosticSafetyControls(baselineEvidence) {
  const emptyProfile = diagnosticFingerprintProfile('');
  if (!emptyProfile.safe) {
    throw new VerifierError('M40_DIAGNOSTIC_FIXTURE_INVALID', 'Focused diagnostic profiles must be accepted by the production classifier', {
      empty: emptyProfile
    });
  }
  const terminalRecord = terminalLine(makeM40TerminalRecord());
  const positiveTerminalOutput = [
    m40LifecycleCandidateLine,
    m40LifecycleFinalizationLine,
    m40LifecycleSidecarLine,
    m40ExpectedTerminationLine,
    '[CLEANUP] database=PASS container=PASS',
    terminalRecord
  ].join('\n');
  const literalExit = baselineEvidence.terminal_mechanism;
  if (!literalExit?.accepted || !exactSortedSet(literalExit.observed_rejection_codes ?? [], [])) {
    throw new VerifierError('M40_LITERAL_EXIT_PROBE_FAILED', 'The isolated literal exit 1 probe did not remain silent', {
      evidence: literalExit
    });
  }
  const controls = [
    {
      id: 'CONTROL-M40-DIAGNOSTIC-01-LITERAL-EXIT-ONE-SILENT',
      expected_rejection_codes: [],
      observed_rejection_codes: literalExit.observed_rejection_codes,
      exact_rejection_set: true,
      expected_set_duplicate_free: true,
      observed_set_duplicate_free: true,
      candidate_changed: literalExit.candidate_changed,
      mutation_target_count: literalExit.mutation_target_count,
      status: literalExit.status,
      signal: literalExit.signal,
      process_error: literalExit.process_error,
      stdout_bytes: literalExit.stdout_bytes,
      stderr_bytes: literalExit.stderr_bytes,
      restoration: literalExit.restoration,
      cleanup: literalExit.cleanup,
      result: 'PASS'
    },
    runPowerShellDiagnosticTerminationControl({
      id: 'CONTROL-M40-DIAGNOSTIC-02-TERMINAL-THROW-REJECTED',
      replacement: "throw 'TERMINAL_PROBE_FAILURE'",
      expectedCodes: [m40DiagnosticRejectionCodes.terminalErrorRecord]
    }),
    runPowerShellDiagnosticTerminationControl({
      id: 'CONTROL-M40-DIAGNOSTIC-03-WRITE-ERROR-REJECTED',
      replacement: "$ErrorActionPreference = 'Stop'; Write-Error 'TERMINAL_PROBE_FAILURE'",
      expectedCodes: [m40DiagnosticRejectionCodes.terminalErrorRecord]
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-04-PRODUCTION-TERMINAL-NO-NEW-ERROR',
      baselineProfile: emptyProfile,
      stdout: positiveTerminalOutput,
      stderr: '',
      expectedCodes: [],
      assertClassification: (value) => value.safe && value.terminal_error_record_count === 0
        && value.raw_m40_sql_diagnostic_count === 0 && value.terminal_added_stderr_count === 0
        && baselineEvidence.terminal_source_ast?.accepted === true
        && baselineEvidence.terminal_mechanism?.accepted === true
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-05-RAW-NEGATIVE-FRAME-REJECTED',
      baselineProfile: emptyProfile,
      stdout: '',
      stderr: 'ERROR: P0001: RAW_NEGATIVE_PREFLIGHT_CONTROL\nCONTEXT: RAW_NEGATIVE_PREFLIGHT_CONTROL',
      expectedCodes: [m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.stderr_line_count === 2
        && value.terminal_added_stderr_count === 2 && !value.baseline_exact_match
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-06-UNCLASSIFIED-PRETERMINAL-REJECTED',
      baselineProfile: emptyProfile,
      stderr: 'UNCLASSIFIED_PRETERMINAL_DIAGNOSTIC',
      expectedCodes: [m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.terminal_added_stderr_count === 1
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-07-CREDENTIAL-LIKE-REJECTED',
      baselineProfile: emptyProfile,
      stderr: 'credential=CONTROL_ONLY_VALUE',
      expectedCodes: [m40DiagnosticRejectionCodes.sensitive],
      assertClassification: (value) => !value.safe
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-08-LOCAL-PRIVATE-PATH-REJECTED',
      baselineProfile: emptyProfile,
      stderr: 'C:\\Users\\private-user\\diagnostic.ps1',
      expectedCodes: [m40DiagnosticRejectionCodes.privatePath],
      assertClassification: (value) => !value.safe
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-09-RAW-M40-SQL-REJECTED',
      baselineProfile: emptyProfile,
      stderr: 'SQLSTATE 57014 from submit_teacher_attendance',
      expectedCodes: [m40DiagnosticRejectionCodes.rawM40Sql],
      assertClassification: (value) => !value.safe && value.raw_m40_sql_diagnostic_count === 1
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-10A-SIDECAR-JSON-STDOUT-REJECTED',
      baselineProfile: emptyProfile,
      stdout: `${m40SemanticPrefix}{"schema":"tecm.m40.semantic.v2"}`,
      stderr: '',
      expectedCodes: [m40DiagnosticRejectionCodes.sidecarPayload],
      assertClassification: (value) => !value.safe && value.sidecar_payload_count > 0
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-10B-SIDECAR-JSON-STDERR-REJECTED',
      baselineProfile: emptyProfile,
      stdout: positiveTerminalOutput,
      stderr: `${m40SemanticPrefix}{"schema":"tecm.m40.semantic.v2"}`,
      expectedCodes: [m40DiagnosticRejectionCodes.postSentinel, m40DiagnosticRejectionCodes.sidecarPayload],
      assertClassification: (value) => !value.safe && value.sidecar_payload_count > 0
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-11-POST-SENTINEL-DIAGNOSTIC-REJECTED',
      baselineProfile: emptyProfile,
      stdout: positiveTerminalOutput,
      stderr: 'UNCLASSIFIED_POST_SENTINEL_DIAGNOSTIC',
      expectedCodes: [m40DiagnosticRejectionCodes.postSentinel, m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.terminal_added_stderr_count === 1
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-12-EMPTY-WHOLE-STDERR-ACCEPTED',
      baselineProfile: emptyProfile,
      stdout: positiveTerminalOutput,
      stderr: '',
      expectedCodes: [],
      assertClassification: (value) => value.safe && value.whole_process_stderr_empty
        && value.baseline_exact_match
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-13-SANITIZED-PRETERMINAL-PLUS-SILENT-EXIT',
      baselineProfile: emptyProfile,
      stdout: positiveTerminalOutput,
      stderr: '',
      expectedCodes: [],
      assertClassification: (value) => value.safe && value.whole_process_stderr_empty
        && value.baseline_exact_match && value.terminal_added_stderr_count === 0
        && literalExit.status === 1 && literalExit.stderr_bytes === 0
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-14-RAW-STDOUT-FRAME-REJECTED',
      baselineProfile: emptyProfile,
      stdout: 'ERROR: P0001: CONTROL_ONLY\nCONTEXT: CONTROL_ONLY',
      stderr: '',
      expectedCodes: [m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.stdout_diagnostic_count === 2
        && value.unknown_diagnostic_count === 2
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-15-FIXED-FAILURE-WITHOUT-REJECTION',
      baselineProfile: emptyProfile,
      stderr: databaseFailureDiagnostic,
      expectedCodes: [m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.unknown_diagnostic_count === 1
    }),
    runDiagnosticFixtureControl({
      id: 'CONTROL-M40-DIAGNOSTIC-16-DUPLICATE-FIXED-FAILURE',
      baselineProfile: emptyProfile,
      stdout: '[M40 REJECT] M40_UNAUTHORIZED_MARKER_OBSERVED',
      stderr: `${databaseFailureDiagnostic}\n${databaseFailureDiagnostic}`,
      expectedCodes: [m40DiagnosticRejectionCodes.unclassified],
      assertClassification: (value) => !value.safe && value.unknown_diagnostic_count === 2
    })
  ];
  if (controls.length < 13 || controls.some(({ candidate_changed: changed, mutation_target_count: count }) => (
    changed !== true || count !== 1
  ))) {
    throw new VerifierError('M40_DIAGNOSTIC_CONTROL_COVERAGE_FAILED', 'Every diagnostic control must mutate exactly one target', {
      control_count: controls.length,
      controls: controls.map(({ id, candidate_changed: changed, mutation_target_count: count }) => ({ id, changed, count }))
    });
  }
  // Parser/NOTICE fixtures do not claim a source mutation. Preserve the existing
  // mutation controls' construction gate before adding their separate results.
  const contracts = runM40NoticeContractControls();
  saveR4AttemptEvidence('F1-F2-contract-controls', contracts);
  return [...controls, ...contracts];
}

function runDatabaseMutation(mutation, options = {}) {
  const controlId = options.controlId ?? mutation.id;
  const parentRoot = mkdtempSync(resolve(tmpdir(), `tecm-teacher-attendance-${controlId.toLowerCase()}-`));
  const worktreeRoot = resolve(parentRoot, 'repository');
  let worktreeAdded = false;
  let worktreeRemoved = false;
  let protectedSnapshots = new Map();
  let failure;
  let result;
  let classification;
  let mutationEvidence;
  let controlMutationEvidence = null;
  let restored = false;
  let cleaned = false;
  try {
    const addResult = spawnSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    if (addResult.status !== 0 || addResult.error || addResult.signal) {
      throw new VerifierError('WORKTREE_CREATE_FAILED', `${mutation.id} could not create an isolated complete-verifier worktree`, {
        exit_code: addResult.status,
        signal: addResult.signal ?? null,
        process_error: addResult.error?.message ?? null,
        output: outputOf(addResult)
      });
    }
    worktreeAdded = true;

    const protectedRelatives = [...new Set([databaseVerifierPath, ...sourceFiles.filter(file => file.startsWith('supabase/tests/concurrency/teacher_attendance_contention_')), mutation.file])];
    for (const relative of protectedRelatives) {
      const destination = resolve(worktreeRoot, relative);
      writeFileSync(destination, readFileSync(resolve(repoRoot, relative)));
      protectedSnapshots.set(relative, snapshot(readFileSync(destination), relative));
    }

    const target = resolve(worktreeRoot, mutation.file);
    if (options.fixtureTransform) {
      writeFileSync(target, options.fixtureTransform(readFileSync(target), mutation));
      protectedSnapshots.set(mutation.file, snapshot(readFileSync(target), mutation.file));
    }
    const original = protectedSnapshots.get(mutation.file);
    const mutated = mutateBytes(original.bytes, mutation);
    writeFileSync(target, mutated.bytes);
    const normalizedMutated = textShape(mutated.bytes).text.replace(/\r\n/g, '\n');
    mutationEvidence = {
      matches: mutated.matches,
      intended_applied: !mutated.bytes.equals(original.bytes)
        && countOccurrences(normalizedMutated, mutation.search) === 0
        && countOccurrences(normalizedMutated, mutation.replacement) === 1,
      input_eol: mutated.eol,
      input_utf8_bom: mutated.utf8_bom,
      source_sha256: original.sha256,
      source_git_blob: original.gitBlob,
      source_raw_git_blob: original.rawGitBlob
    };

    if (options.competitorMutation) {
      const competitor = resolve(worktreeRoot, contentionCompetitorPath);
      const competitorOriginal = protectedSnapshots.get(contentionCompetitorPath);
      const controlMutation = mutateBytes(competitorOriginal.bytes, { ...options.competitorMutation, sqlSource: true });
      writeFileSync(competitor, controlMutation.bytes);
      controlMutationEvidence = {
        id: options.competitorMutation.id,
        file: contentionCompetitorPath,
        matches: controlMutation.matches,
        intended_applied: !controlMutation.bytes.equals(competitorOriginal.bytes)
      };
    }

    if (options.holderMutation) {
      if (controlMutationEvidence || options.verifierMutation) throw new VerifierError('M40_CONTROL_MUTATION_INVALID', 'Only one auxiliary mutation is allowed');
      const file = 'supabase/tests/concurrency/teacher_attendance_contention_holder.sql';
      const original = protectedSnapshots.get(file);
      const change = mutateBytes(original.bytes, { ...options.holderMutation, sqlSource: true });
      writeFileSync(resolve(worktreeRoot,file), change.bytes);
      controlMutationEvidence = { id: options.holderMutation.id, file, matches: change.matches, intended_applied: !change.bytes.equals(original.bytes) };
    }
    if (options.verifierMutation) {
      if (controlMutationEvidence) {
        throw new VerifierError('M40_CONTROL_MUTATION_INVALID', `${controlId} may use only one auxiliary source mutation`);
      }
      const verifier = resolve(worktreeRoot, databaseVerifierPath);
      const verifierOriginal = protectedSnapshots.get(databaseVerifierPath);
      const controlMutation = mutateBytes(verifierOriginal.bytes, options.verifierMutation);
      writeFileSync(verifier, controlMutation.bytes);
      controlMutationEvidence = {
        id: options.verifierMutation.id,
        file: databaseVerifierPath,
        matches: controlMutation.matches,
        intended_applied: !controlMutation.bytes.equals(verifierOriginal.bytes)
      };
    }

    if (options.traceMode) {
      const competitor = resolve(worktreeRoot, contentionCompetitorPath);
      writeFileSync(competitor, instrumentM40TraceSql(readFileSync(competitor), options.traceMode));
    }
    result = runDatabaseProbe(worktreeRoot, { m40Sidecar: true, traceMode: options.traceMode ?? null });
    classification = databaseFailureClassification(result, mutation, {
      diagnosticBaseline: options.baselineEvidence?.m40_diagnostic_profile ?? null,
      terminalAst: options.baselineEvidence?.terminal_source_ast ?? null,
      terminalMechanism: options.baselineEvidence?.terminal_mechanism ?? null
    });
  } catch (error) {
    failure = error instanceof VerifierError
      ? error
      : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    if (worktreeAdded && protectedSnapshots.size > 0) {
      try {
        for (const [relative, original] of protectedSnapshots) {
          writeFileSync(resolve(worktreeRoot, relative), original.bytes);
        }
        if (options.injectRestorationMismatch) {
          const original = protectedSnapshots.get(mutation.file);
          writeFileSync(resolve(worktreeRoot, mutation.file), Buffer.concat([original.bytes, Buffer.from('mismatch')]));
        }
        restored = [...protectedSnapshots].every(([relative, original]) => {
          const restoredBytes = readFileSync(resolve(worktreeRoot, relative));
          return restoredBytes.equals(original.bytes)
            && sha256(restoredBytes) === original.sha256
            && filteredGitBlob(restoredBytes, relative) === original.gitBlob
            && rawGitBlob(restoredBytes) === original.rawGitBlob;
        });
        if (!restored && !failure) {
          failure = new VerifierError('RESTORATION_MISMATCH', `${controlId} isolated worktree restoration mismatch`);
        }
      } catch (error) {
        if (!failure) failure = new VerifierError('RESTORATION_FAILED', `${controlId} isolated worktree restoration failed`, { error: String(error) });
      }
    }
    if (worktreeAdded) {
      const removeResult = spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      });
      worktreeRemoved = removeResult.status === 0 && !removeResult.error && !removeResult.signal;
      if (!worktreeRemoved && !failure) {
        failure = new VerifierError('WORKTREE_CLEANUP_FAILED', `${mutation.id} isolated worktree could not be removed`, {
          exit_code: removeResult.status,
          signal: removeResult.signal ?? null,
          process_error: removeResult.error?.message ?? null,
          output: outputOf(removeResult)
        });
      }
    }
    rmSync(parentRoot, { recursive: true, force: true });
    cleaned = !existsSync(parentRoot) && (!worktreeAdded || worktreeRemoved);
    const repository = repoRestorationEvidence();
    if (!cleaned && !failure) failure = new VerifierError('CLEANUP_FAILED', `${mutation.id} workspace cleanup failed`);
    if (repository.status !== 'PASS' && !failure) {
      failure = new VerifierError('SOURCE_RESTORATION_FAILED', `${mutation.id} protected repository source changed`, { repository });
    }
    if (failure) {
      failure.cleanup = cleaned ? 'PASS' : 'FAIL';
      failure.details = { ...failure.details, repository_restoration: repository.status, worktree_removed: worktreeRemoved };
    }
  }
  if (failure) throw failure;

  const sourceRestoration = restored ? 'PASS' : 'FAIL';
  const worktreeCleanup = worktreeRemoved ? 'PASS' : 'FAIL';
  const workspaceCleanup = cleaned ? 'PASS' : 'FAIL';
  const evaluation = evaluateM40Caught({
    baselinePassed: options.baselineEvidence?.passed === true,
    mutationMatches: mutationEvidence.matches,
    intendedMutationApplied: mutationEvidence.intended_applied,
    completeNoArgumentVerifierRan: true,
    classification,
    sourceRestoration,
    worktreeCleanup,
    workspaceCleanup
  });
  saveR4AttemptEvidence('control-' + controlId + '-decision', { evaluation, classification,
    construction: mutationEvidence, control_construction: controlMutationEvidence, sourceRestoration, worktreeCleanup, workspaceCleanup });
  const caught = evaluation.caught;

  if (options.diagnosticOnly === true) {
    return { id: controlId, diagnostic_only: true, caught: false, semantic_authority: false,
      observed_rejection_codes: evaluation.rejection_codes, classification,
      diagnostic_trace: result.m40_trace ?? null, job_capture: result.m40_job_capture ?? null,
      deadline_diagnosis: r4DeadlineDiagnosis(result.m40_job_capture),
      source_restoration: sourceRestoration, worktree_cleanup: worktreeCleanup, workspace_cleanup: workspaceCleanup };
  }
  const expectedCaught = options.expectedCaught ?? true;
  const expectedRejectionCodes = [...(options.expectedRejectionCodes ?? [])].sort();
  if (!expectedCaught && expectedRejectionCodes.length === 0) {
    throw new VerifierError('M40_CONTROL_CONTRACT_INVALID', `${controlId} must define expected rejection codes`);
  }
  const rejectionCodesMatch = exactSortedSet(evaluation.rejection_codes, expectedRejectionCodes);
  const observedSignatures = [...classification.semantic_signatures].sort();
  const expectedSignatures = [...(options.expectedSemanticSignatures ?? [
    'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false'
  ])].sort();
  const signaturesMatch = observedSignatures.length === expectedSignatures.length
    && observedSignatures.every((value, index) => value === expectedSignatures[index]);
  const completeProcessContract = classification.exit_code === 1
    && classification.timed_out === false
    && classification.signal === null
    && classification.process_error === null
    && classification.database_cleanup === 'PASS'
    && classification.container_cleanup === 'PASS'
    && classification.sidecar_cleanup === 'PASS'
    && (classification.diagnostic_safety.safe === true || (
      options.expectedTraceDiagnosticCount !== undefined
      && classification.diagnostic_safety.stream_safe === true
      && classification.diagnostic_safety.unknown_diagnostic_count === options.expectedTraceDiagnosticCount
      && classification.diagnostic_safety.trace_unknown_diagnostic_count === options.expectedTraceDiagnosticCount));
  const requiredSqlState = options.requiredObservedSqlState ?? null;
  const sourceMutationExecuted = controlMutationEvidence
    ? controlMutationEvidence.intended_applied === true
    : mutationEvidence.intended_applied === true;
  const sqlExecutionProved = requiredSqlState === null || (
    sourceMutationExecuted
    && classification.semantic_sqlstates.length === 1
    && classification.semantic_sqlstates[0] === requiredSqlState
  );
  const processMarkerRequirementMet = options.requiredUnauthorizedProcessMarker === undefined
    || classification.unauthorized_process_output === options.requiredUnauthorizedProcessMarker;
  const lifecycleRecord = classification.lifecycle_records.length === 1
    ? classification.lifecycle_records[0]
    : null;
  const lifecycleRequirementsMet = Object.entries(options.requiredLifecycle ?? {})
    .every(([key, value]) => lifecycleRecord?.[key] === value);
  const lifecycleSqlStateRequirementMet = options.requiredLifecycleFailureSqlState === undefined
    || (classification.lifecycle_failure_sqlstates.length === 1
      && classification.lifecycle_failure_sqlstates[0] === options.requiredLifecycleFailureSqlState);
  const lifecycleFailureRequirementMet = options.requiredLifecycleFailure === undefined
    || classification.lifecycle_failure === options.requiredLifecycleFailure;
  const terminalFailureOccurrencesRequirementMet = options.expectedTerminalFailureOccurrences === undefined
    || classification.terminal_failure_sentinel.total_occurrences === options.expectedTerminalFailureOccurrences;
  const terminalDiagnosticSanitizationRequirementMet = options.requiredTerminalDiagnosticSanitized !== true
    || classification.terminal_failure_sentinel.terminal_diagnostic_sanitized === true;
  const productionTerminalContractRequirementMet = options.requiredProductionTerminalContract !== true
    || classification.production_terminal_contract.accepted === true;
  const semanticCandidateRequirementMet = options.requiredSemanticCandidate !== true
    || classification.semantic_candidate_records === 1;
  const stdoutLines = (result.stdout ?? '').split(/\r?\n/);
  const stderrLines = (result.stderr ?? '').split(/\r?\n/);
  const requiredSanitizedStream = options.requiredSanitizedStream ?? 'stdout';
  if (!['stdout', 'stderr'].includes(requiredSanitizedStream)) {
    throw new VerifierError('M40_CONTROL_CONTRACT_INVALID', `${controlId} requested an invalid rejection stream`);
  }
  const requiredSanitizedCodeMet = options.requiredSanitizedCode === undefined
    || (
      (requiredSanitizedStream === 'stdout' ? stdoutLines : stderrLines)
        .filter((line) => line === `[M40 REJECT] ${options.requiredSanitizedCode}`).length === 1
      && (requiredSanitizedStream === 'stdout' ? stderrLines : stdoutLines)
        .filter((line) => line === `[M40 REJECT] ${options.requiredSanitizedCode}`).length === 0
    );
  const forbiddenOutputAbsent = (options.forbiddenOutputFragments ?? [])
    .every((fragment) => !outputOf(result).includes(fragment));
  if (caught !== expectedCaught || !rejectionCodesMatch || !signaturesMatch || !completeProcessContract
      || !sqlExecutionProved || !processMarkerRequirementMet
      || !lifecycleRequirementsMet || !lifecycleSqlStateRequirementMet || !lifecycleFailureRequirementMet
      || !terminalFailureOccurrencesRequirementMet || !terminalDiagnosticSanitizationRequirementMet
      || !productionTerminalContractRequirementMet
      || !semanticCandidateRequirementMet || !requiredSanitizedCodeMet || !forbiddenOutputAbsent
      || sourceRestoration !== 'PASS' || worktreeCleanup !== 'PASS' || workspaceCleanup !== 'PASS') {
    throw new VerifierError('M40_CONTROL_CONTRACT_FAILED', `${controlId} did not satisfy the complete M40 contract`, {
      control: controlId,
      expected_caught: expectedCaught,
      observed_caught: caught,
      expected_rejection_codes: expectedRejectionCodes,
      observed_rejection_codes: evaluation.rejection_codes,
      expected_semantic_classifications: expectedSignatures,
      observed_semantic_classifications: observedSignatures,
      required_sqlstate: requiredSqlState,
      sql_execution_proved: sqlExecutionProved,
      required_unauthorized_process_marker: options.requiredUnauthorizedProcessMarker ?? null,
      unauthorized_process_marker_observed: classification.unauthorized_process_output,
      required_lifecycle: options.requiredLifecycle ?? null,
      lifecycle_requirements_met: lifecycleRequirementsMet,
      required_lifecycle_failure_sqlstate: options.requiredLifecycleFailureSqlState ?? null,
      lifecycle_sqlstate_requirement_met: lifecycleSqlStateRequirementMet,
      required_lifecycle_failure: options.requiredLifecycleFailure ?? null,
      lifecycle_failure_requirement_met: lifecycleFailureRequirementMet,
      expected_terminal_failure_occurrences: options.expectedTerminalFailureOccurrences ?? null,
      observed_terminal_failure_occurrences: classification.terminal_failure_sentinel.total_occurrences,
      terminal_failure_occurrences_requirement_met: terminalFailureOccurrencesRequirementMet,
      required_terminal_diagnostic_sanitized: options.requiredTerminalDiagnosticSanitized ?? false,
      terminal_diagnostic_sanitization_requirement_met: terminalDiagnosticSanitizationRequirementMet,
      required_production_terminal_contract: options.requiredProductionTerminalContract ?? false,
      production_terminal_contract_requirement_met: productionTerminalContractRequirementMet,
      required_semantic_candidate: options.requiredSemanticCandidate ?? false,
      semantic_candidate_requirement_met: semanticCandidateRequirementMet,
      required_sanitized_code: options.requiredSanitizedCode ?? null,
      required_sanitized_stream: options.requiredSanitizedCode === undefined ? null : requiredSanitizedStream,
      required_sanitized_code_met: requiredSanitizedCodeMet,
      forbidden_output_absent: forbiddenOutputAbsent,
      classification,
      construction: controlMutationEvidence,
      source_restoration: sourceRestoration,
      worktree_cleanup: worktreeCleanup,
      workspace_cleanup: workspaceCleanup
    });
  }
  return {
    id: controlId,
    file: mutation.file,
    matches: mutationEvidence.matches,
    intended_mutation_applied: mutationEvidence.intended_applied,
    expected_test: mutation.expectedTest,
    expected_failure: mutation.expectedFailure,
    caught,
    expected_caught: expectedCaught,
    expected_rejection_codes: expectedRejectionCodes,
    observed_rejection_codes: evaluation.rejection_codes,
    input_eol: mutationEvidence.input_eol,
    input_utf8_bom: mutationEvidence.input_utf8_bom,
    source_sha256: mutationEvidence.source_sha256,
    source_git_blob: mutationEvidence.source_git_blob,
    source_raw_git_blob: mutationEvidence.source_raw_git_blob,
    semantic_mapping: mutation.semanticMapping ?? null,
    mutation_target: mutation.mutationTarget ?? mutation.file,
    control_mutation: controlMutationEvidence,
    required_sqlstate: requiredSqlState,
    sql_statement_executed: sqlExecutionProved,
    unauthorized_process_marker_observed: classification.unauthorized_process_output,
    semantic_candidate_observed: classification.semantic_candidate_records === 1,
    required_lifecycle: options.requiredLifecycle ?? null,
    lifecycle_requirements_met: lifecycleRequirementsMet,
    required_lifecycle_failure_sqlstate: options.requiredLifecycleFailureSqlState ?? null,
    lifecycle_sqlstate_requirement_met: lifecycleSqlStateRequirementMet,
    required_lifecycle_failure: options.requiredLifecycleFailure ?? null,
    lifecycle_failure_requirement_met: lifecycleFailureRequirementMet,
    expected_terminal_failure_occurrences: options.expectedTerminalFailureOccurrences ?? null,
    observed_terminal_failure_occurrences: classification.terminal_failure_sentinel.total_occurrences,
    terminal_failure_occurrences_requirement_met: terminalFailureOccurrencesRequirementMet,
    required_terminal_diagnostic_sanitized: options.requiredTerminalDiagnosticSanitized ?? false,
    terminal_diagnostic_sanitization_requirement_met: terminalDiagnosticSanitizationRequirementMet,
    required_production_terminal_contract: options.requiredProductionTerminalContract ?? false,
    production_terminal_contract_requirement_met: productionTerminalContractRequirementMet,
    required_sanitized_code: options.requiredSanitizedCode ?? null,
    required_sanitized_stream: options.requiredSanitizedCode === undefined ? null : requiredSanitizedStream,
    required_sanitized_code_met: requiredSanitizedCodeMet,
    forbidden_output_absent: forbiddenOutputAbsent,
    expected_semantic_classifications: expectedSignatures,
    observed_semantic_classifications: observedSignatures,
    lifecycle_failure: classification.lifecycle_failure,
    database_cleanup: classification.database_cleanup,
    container_cleanup: classification.container_cleanup,
    sidecar_cleanup: classification.sidecar_cleanup,
    process_contract: classification,
    diagnostic_trace: result.m40_trace ?? null,
    trace_tamper_controls: options.traceMode === 'slow' && result.m40_trace?.accepted
      ? runR3TraceTamperControls(result.m40_trace, result.m40_trace_context) : null,
    restoration: sourceRestoration,
    worktree_cleanup: worktreeCleanup,
    workspace_cleanup: workspaceCleanup,
    cleanup: cleaned ? 'PASS' : 'FAIL',
    final_result: 'PASS'
  };
}

function runM40LifecycleControls(mutation, baselineEvidence, selectedControl = null) {
  const canonicalSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false';
  const unauthorizedSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|true';
  const callTarget = '    perform public.submit_teacher_attendance(';
  const sanitizedCanary = `${m40SemanticPrefix}M40_SANITIZED_CANARY_PAYLOAD_7F3A2D91_FULL_DIAGNOSTIC`;
  const holderReleaseFailure = !selectedControl || selectedControl === 'A' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-A-HOLDER-RELEASE-FAILURE',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_HOLDER_RELEASE_FAILED',
      'M40_LIFECYCLE_FAILURE_OBSERVED',
      'M40_LOWER_CLASSIFIER_REJECTED'
    ],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_HOLDER_RELEASE_FAILED',
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'FAIL',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'FAIL'
    },
    verifierMutation: {
      id: 'M40-CONTROL-A-HOLDER-RELEASE-FAILURE',
      search: "        '-c', $holderReleaseSql",
      replacement: "        '-c', \"select public.__tecm_m40_missing_holder_release_control()\""
    }
  }) : null;
  const postCandidate22023 = !selectedControl || selectedControl === 'B' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-B-POST-CANDIDATE-22023',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_LIFECYCLE_FAILURE_OBSERVED',
      'M40_LOWER_CLASSIFIER_REJECTED',
      'M40_POST_CANDIDATE_SQL_22023'
    ],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredLifecycleFailureSqlState: '22023',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_POST_CANDIDATE_SQL_22023',
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'FAIL',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'FAIL'
    },
    verifierMutation: {
      id: 'M40-CONTROL-B-POST-CANDIDATE-22023',
      search: "          '-c', $m40PostCandidateAssertionSql",
      replacement: "          '-c', \"do `$tecm`$ begin raise exception using errcode = '22023', message = 'M40_POST_CANDIDATE_22023_CONTROL'; end `$tecm`$;\""
    }
  }) : null;
  const sanitizedUnauthorizedMarker = !selectedControl || selectedControl === 'C' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-C-SANITIZED-UNAUTHORIZED-MARKER',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_LOWER_CLASSIFIER_REJECTED',
      'M40_UNAUTHORIZED_MARKER_OBSERVED'
    ],
    expectedSemanticSignatures: [unauthorizedSignature],
    requiredObservedSqlState: '57014',
    requiredUnauthorizedProcessMarker: false,
    requiredSemanticCandidate: true,
    requiredLifecycleFailure: false,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_UNAUTHORIZED_MARKER_OBSERVED',
    forbiddenOutputFragments: [sanitizedCanary],
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS'
    },
    competitorMutation: {
      id: 'M40-CONTROL-C-SANITIZED-UNAUTHORIZED-MARKER',
      search: callTarget,
      replacement: `    raise notice '${sanitizedCanary}';\n${callTarget}`
    }
  }) : null;
  const finalizationSuccess = !selectedControl || selectedControl === 'D' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-D-FINALIZATION-SUCCESS',
    baselineEvidence,
    expectedCaught: true,
    expectedRejectionCodes: [],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredTerminalDiagnosticSanitized: true,
    requiredProductionTerminalContract: true,
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS'
    }
  }) : null;
  return [
    holderReleaseFailure && { ...holderReleaseFailure, control: 'A', proof: 'valid M40 candidate followed by checked holder-release failure and successful emergency cleanup' },
    postCandidate22023 && { ...postCandidate22023, control: 'B', proof: 'valid M40 candidate followed by actual PowerShell-path SQLSTATE 22023 before sidecar acceptance' },
    sanitizedUnauthorizedMarker && { ...sanitizedUnauthorizedMarker, control: 'C', canary_absent: true, proof: 'unauthorized marker detected while complete synthetic diagnostic remained absent from process output' },
    finalizationSuccess && { ...finalizationSuccess, control: 'D', proof: 'candidate, finalization, atomic sidecar commit, exact termination, and outer cleanup completed in order' }
  ].filter(Boolean);
}

function m40PostSidecar22023VerifierMutation(stream) {
  const emitRejection = stream === 'stderr'
    ? '      [Console]::Error.WriteLine("$m40RejectionPrefix M40_POST_SIDECAR_SQL_22023")'
    : '      Write-Host "$m40RejectionPrefix M40_POST_SIDECAR_SQL_22023"';
  return {
    id: `M40-R2-${stream.toUpperCase()}-POST-SIDECAR-22023`,
    search: '      Write-Host "[M40 EXPECTED TERMINATION] $m40ExpectedTermination"',
    replacement: `      $m40PostSidecarControl = Invoke-M40DockerCommand -Arguments @(
        'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
        '-U', 'postgres', '-d', $database,
        '-c', "do \`$tecm\`$ begin raise exception using errcode = '22023', message = 'M40_POST_SIDECAR_22023_CONTROL'; end \`$tecm\`$;"
      )
      $m40PostSidecarDiagnostic = Get-SanitizedM40SqlDiagnostic -Output $m40PostSidecarControl.Output
      if ($m40PostSidecarControl.ProcessError -or $m40PostSidecarControl.Signal -or
          $m40PostSidecarControl.ExitCode -eq 0 -or $m40PostSidecarDiagnostic.SqlState -ne '22023') {
        throw 'M40_POST_SIDECAR_CONTROL_NOT_EXECUTED'
      }
${emitRejection}
      $script:m40TerminalRejectionEmitted = 'M40_POST_SIDECAR_SQL_22023'
      throw 'M40_POST_SIDECAR_SQL_22023'`
  };
}

function runM40TerminalControls(mutation, baselineEvidence, selectedControl = null, exactPositiveEvidence = null) {
  const canonicalSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false';
  const terminalFailureCodes = (specificCode) => [
    'M40_LIFECYCLE_FAILURE_OBSERVED',
    'M40_LOWER_CLASSIFIER_REJECTED',
    specificCode,
    'M40_TERMINAL_RECORD_MISSING',
    'M40_TERMINATION_PROTOCOL_INVALID'
  ];
  const finalizedLifecycle = {
    semantic_candidate: 'PASS',
    post_candidate_assertion: 'PASS',
    holder_release: 'PASS',
    holder_terminal: 'PASS',
    competitor_terminal: 'PASS',
    jobs_stopped: 'NOT_REQUIRED',
    jobs_removed: 'PASS',
    barrier_cleanup: 'PASS',
    finalization: 'PASS'
  };
  const stdout22023 = !selectedControl || selectedControl === 'R2-B' ? runDatabaseMutation(mutation, {
    controlId: 'M40-R2-B-STDOUT-POST-SIDECAR-22023',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: terminalFailureCodes('M40_POST_SIDECAR_SQL_22023'),
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_POST_SIDECAR_SQL_22023',
    requiredSanitizedStream: 'stdout',
    requiredLifecycle: finalizedLifecycle,
    verifierMutation: m40PostSidecar22023VerifierMutation('stdout')
  }) : null;
  const stderr22023 = !selectedControl || selectedControl === 'R2-C' ? runDatabaseMutation(mutation, {
    controlId: 'M40-R2-C-STDERR-POST-SIDECAR-22023',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: terminalFailureCodes('M40_POST_SIDECAR_SQL_22023'),
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_POST_SIDECAR_SQL_22023',
    requiredSanitizedStream: 'stderr',
    requiredLifecycle: finalizedLifecycle,
    verifierMutation: m40PostSidecar22023VerifierMutation('stderr')
  }) : null;
  const terminalFailure = !selectedControl || selectedControl === 'R2-D' ? runDatabaseMutation(mutation, {
    controlId: 'M40-R2-D-PRODUCTION-TERMINAL-FAILURE',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: terminalFailureCodes('M40_TERMINAL_FINALIZATION_FAILED'),
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    expectedTerminalFailureOccurrences: 0,
    requiredSanitizedCode: 'M40_TERMINAL_FINALIZATION_FAILED',
    requiredSanitizedStream: 'stdout',
    requiredLifecycle: finalizedLifecycle,
    verifierMutation: {
      id: 'M40-R2-D-PRODUCTION-TERMINAL-FAILURE',
      search: '      Write-Host "[M40 EXPECTED TERMINATION] $m40ExpectedTermination"',
      replacement: "      throw 'M40_TERMINAL_FINALIZATION_FAILED'"
    }
  }) : null;
  let exactPositive = null;
  if (!selectedControl || selectedControl === 'R2-E') {
    exactPositive = exactPositiveEvidence ?? runM40LifecycleControls(mutation, baselineEvidence, 'D')[0];
    if (!exactPositive?.caught || exactPositive.lifecycle_failure
        || exactPositive.process_contract?.exact_terminal_outcome !== true
        || exactPositive.process_contract?.exact_termination_protocol !== true
        || exactPositive.process_contract?.production_terminal_contract?.accepted !== true
        || exactPositive.process_contract?.diagnostic_safety?.safe !== true
        || exactPositive.observed_rejection_codes?.length !== 0) {
      throw new VerifierError('M40_R2_EXACT_POSITIVE_FAILED', 'R2-E exact positive terminal protocol did not pass', {
        evidence: exactPositive
      });
    }
  }
  return [
    stdout22023 && { ...stdout22023, r2_control: 'B', terminal_fault_sqlstate: '22023', proof: 'post-sidecar SQL executed and its sanitized rejection was emitted only on stdout' },
    stderr22023 && { ...stderr22023, r2_control: 'C', terminal_fault_sqlstate: '22023', proof: 'post-sidecar SQL executed and its sanitized rejection was emitted only on stderr' },
    terminalFailure && { ...terminalFailure, r2_control: 'D', proof: 'authoritative semantic finalization was followed by a production terminal-stage failure and successful outer cleanup' },
    exactPositive && { ...exactPositive, r2_control: 'E', proof: 'exact 57014 sidecar, expected termination, outer cleanup, and correlated terminal outcome passed with no rejection' }
  ].filter(Boolean);
}

function runM40SqlControls(mutation, baselineEvidence, selectedControl = null) {
  const callTarget = '    perform public.submit_teacher_attendance(';
  const unauthorizedRecordText = semanticLine(makeM40Record());
  const lowerRejected = 'M40_LOWER_CLASSIFIER_REJECTED';
  const controls = [
    {
      id: 'M40-REAL-UNRELATED-SQL',
      statement: "raise exception using errcode = '22023', message = 'UNRELATED_M40_SQL_PROBE';",
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|22023|UNRELATED_M40_SQL_PROBE|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE'],
      requiredObservedSqlState: '22023'
    },
    {
      id: 'M40-REAL-OLD-HUMAN-TEXT',
      error: 'M40 bounded contention classification missing',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|redacted_unexpected_sql_error|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE']
    },
    {
      id: 'M40-REAL-GENERIC-P0001',
      error: 'GENERIC_P0001_M40_PROBE',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|GENERIC_P0001_M40_PROBE|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE']
    },
    {
      id: 'M40-REAL-UNAUTHORIZED-MARKER',
      error: 'UNAUTHORIZED_M40_MARKER_PROBE',
      unauthorizedMarker: true,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|UNAUTHORIZED_M40_MARKER_PROBE|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', 'M40_UNRELATED_SQL_FAILURE'],
      requiredUnauthorizedProcessMarker: false
    },
    {
      id: 'M40-REAL-FORGED-RECORD-UNRELATED-SQL',
      statement: "raise exception using errcode = '22023', message = 'UNRELATED_M40_SQL_PROBE';",
      unauthorizedMarker: true,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|22023|UNRELATED_M40_SQL_PROBE|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', 'M40_UNRELATED_SQL_FAILURE'],
      requiredObservedSqlState: '22023',
      requiredUnauthorizedProcessMarker: false
    },
    {
      id: 'M40-REAL-MARKER-PLUS-VALID-BLOCK',
      continueToBlockingMutation: true,
      unauthorizedMarker: true,
      expectedSignature: 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED'],
      requiredObservedSqlState: '57014',
      requiredUnauthorizedProcessMarker: false
    }
  ];
  return controls.filter(({ id }) => !selectedControl || id === selectedControl).map((control) => {
    const notice = control.unauthorizedMarker
      ? `    raise notice '${unauthorizedRecordText}';\n`
      : '';
    const statement = control.statement ?? `raise exception '${control.error}';`;
    const replacement = control.continueToBlockingMutation
      ? `${notice}${callTarget}`
      : `${notice}    ${statement}\n${callTarget}`;
    return runDatabaseMutation(mutation, {
      controlId: control.id,
      baselineEvidence,
      expectedCaught: false,
      expectedRejectionCodes: control.expectedRejectionCodes,
      expectedSemanticSignatures: [control.expectedSignature],
      requiredObservedSqlState: control.requiredObservedSqlState,
      requiredUnauthorizedProcessMarker: control.requiredUnauthorizedProcessMarker,
      competitorMutation: {
        id: control.id,
        search: callTarget,
        replacement
      }
    });
  });
}

function runM40TimeoutScopeControls(mutation, baselineEvidence, selectedControl = null) {
  const timeoutArm = "\\echo @@TECM_M40_PHASE@@rpc_timeout_armed\nset statement_timeout = '3s';";
  const rpcStatementStart = '\\echo @@TECM_M40_PHASE@@rpc_statement_started\ndo $$';
  const canonicalSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false';
  const slowSetup = !selectedControl || selectedControl === 'slow-pre-rpc' ? runDatabaseMutation(mutation, {
    controlId: 'M40-REAL-SLOW-PRE-RPC-SETUP',
    traceMode: 'slow',
    baselineEvidence,
    expectedCaught: true,
    expectedRejectionCodes: [],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    competitorMutation: {
      id: 'M40-REAL-SLOW-PRE-RPC-SETUP',
      search: timeoutArm,
      replacement: `select pg_sleep(3.25);\n${timeoutArm}`
    }
  }) : null;
  const outsideRpcTimeout = !selectedControl || selectedControl === 'pre-rpc-57014' ? runDatabaseMutation(mutation, {
    controlId: 'M40-REAL-PRE-RPC-57014',
    traceMode: 'pre-rpc',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: ['M40_LOWER_CLASSIFIER_REJECTED', 'M40_UNRELATED_SQL_FAILURE'],
    expectedSemanticSignatures: [
      'unrelated_sql_error|unexpected_sql_failure|57014|pre_rpc_statement_timeout|false'
    ],
    requiredObservedSqlState: '57014',
    competitorMutation: {
      id: 'M40-REAL-PRE-RPC-57014',
      search: rpcStatementStart,
      replacement: `\\echo @@TECM_M40_PHASE@@pre_rpc_timeout_control\nselect pg_sleep(5);\n${rpcStatementStart}`
    }
  }) : null;
  return [
    slowSetup && {
      ...slowSetup,
      pre_rpc_delay_milliseconds: slowSetup.diagnostic_trace.slow_duration_ms,
      proof: 'pre-RPC delay completed before the short database timeout was armed'
    },
    outsideRpcTimeout && {
      ...outsideRpcTimeout,
      proof: 'database-side 57014 before the real RPC remained unrelated and uncaught'
    }
  ].filter(Boolean);
}

function runM40DifferentMutationControl(baselineEvidence) {
  const mutation = {
    id: 'M40-REAL-DIFFERENT-MUTATION',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "    raise exception 'attendance update is already in progress';",
    replacement: "    raise exception 'GENERIC_P0001_M40_PROBE';",
    expectedTest: 'database existing/absent attendance contention proof',
    expectedFailure: 'unrelated_sql_error',
    databaseProbe: true,
    mutationTarget: 'canonical immediate-contention diagnostic, without changing the nonblocking advisory lock'
  };
  const evidence = runDatabaseMutation(mutation, {
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: ['M40_LOWER_CLASSIFIER_REJECTED', 'M40_UNRELATED_SQL_FAILURE'],
    expectedSemanticSignatures: [
      'unrelated_sql_error|unexpected_sql_failure|P0001|GENERIC_P0001_M40_PROBE|false'
    ],
    requiredObservedSqlState: 'P0001'
  });
  const postRestorationBaseline = runDatabaseBaseline();
  return {
    ...evidence,
    semantic_difference: 'nonblocking lock retained; canonical rejection diagnostic changed in the disposable migration',
    mutation_body_executed: evidence.sql_statement_executed,
    post_restoration_baseline: postRestorationBaseline,
    final_result: postRestorationBaseline.passed ? 'PASS' : 'FAIL'
  };
}

function runM40TargetCountControls(baselineEvidence) {
  const controls = [
    { name: 'm40-zero-match', expectedMatches: 0 },
    { name: 'm40-multiple-match', expectedMatches: 2 }
  ];
  return controls.map((control) => {
    const child = spawnSync(process.execPath, [resolve(repoRoot, verifierPath), `--control=${control.name}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const result = parseJsonLine(outputOf(child));
    const passed = baselineEvidence.passed
      && child.status === 1
      && !child.error
      && !child.signal
      && result?.code === 'MATCH_COUNT'
      && result?.details?.matches === control.expectedMatches
      && result?.details?.repository_restoration === 'PASS'
      && result?.details?.worktree_removed === true
      && result?.cleanup === 'PASS';
    if (!passed) {
      throw new VerifierError('M40_TARGET_COUNT_CONTROL_FAILED', `${control.name} did not fail closed`, {
        control: control.name,
        expected_matches: control.expectedMatches,
        exit_code: child.status,
        timed_out: child.error?.code === 'ETIMEDOUT',
        signal: child.signal ?? null,
        result
      });
    }
    return {
      control: control.name,
      expected_matches: control.expectedMatches,
      observed_matches: result.details.matches,
      expected_classifications: ['MATCH_COUNT'],
      observed_classifications: [result.code],
      restoration: 'PASS',
      worktree_cleanup: 'PASS',
      workspace_cleanup: result.cleanup,
      result: 'PASS'
    };
  });
}

function runMutation(mutation, options = {}) {
  if (mutation.databaseProbe) return runDatabaseMutation(mutation, options);
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-teacher-attendance-${mutation.id.toLowerCase()}-`));
  let failure;
  let evidence;
  let restored = false;
  let cleaned = false;
  try {
    copyFixture(tempRoot);
    const target = resolve(tempRoot, mutation.file);
    if (options.fixtureTransform) {
      writeFileSync(target, options.fixtureTransform(readFileSync(target), mutation));
    }
    const original = snapshot(readFileSync(target), mutation.file);
    const mutated = mutateBytes(original.bytes, mutation);
    writeFileSync(target, mutated.bytes);
    const result = runTest(tempRoot, mutation.expectedTest);
    const classification = testFailureClassification(result, mutation);
    if (!classification.caught) {
      throw new VerifierError(
        'WRONG_FAILURE_CLASSIFICATION',
        `${mutation.id} was not caught for the intended safety assertion`,
        { mutation: mutation.id, classification }
      );
    }
    evidence = {
      id: mutation.id,
      file: mutation.file,
      matches: mutated.matches,
      expected_test: mutation.expectedTest,
      expected_failure: mutation.expectedFailure,
      caught: true,
      input_eol: mutated.eol,
      input_utf8_bom: mutated.utf8_bom,
      source_sha256: original.sha256,
      source_git_blob: original.gitBlob,
      source_raw_git_blob: original.rawGitBlob,
      semantic_mapping: mutation.semanticMapping ?? null,
      mutation_target: mutation.mutationTarget ?? mutation.file,
      lifecycle_failure: classification.lifecycle_failure ?? false,
      database_cleanup: classification.database_cleanup ?? 'NOT_APPLICABLE',
      container_cleanup: classification.container_cleanup ?? 'NOT_APPLICABLE'
    };

    writeFileSync(target, original.bytes);
    if (options.injectRestorationMismatch) writeFileSync(target, Buffer.concat([original.bytes, Buffer.from('mismatch')]));
    const restoredBytes = readFileSync(target);
    restored = restoredBytes.equals(original.bytes)
      && sha256(restoredBytes) === original.sha256
      && filteredGitBlob(restoredBytes, mutation.file) === original.gitBlob
      && rawGitBlob(restoredBytes) === original.rawGitBlob;
    if (!restored) {
      throw new VerifierError('RESTORATION_MISMATCH', `${mutation.id} fixture restoration mismatch`, {
        mutation: mutation.id,
        expected_sha256: original.sha256,
        actual_sha256: sha256(restoredBytes),
        expected_git_blob: original.gitBlob,
        actual_git_blob: filteredGitBlob(restoredBytes, mutation.file),
        expected_raw_git_blob: original.rawGitBlob,
        actual_raw_git_blob: rawGitBlob(restoredBytes)
      });
    }
  } catch (error) {
    failure = error instanceof VerifierError
      ? error
      : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
    const repository = repoRestorationEvidence();
    if (!cleaned && !failure) failure = new VerifierError('CLEANUP_FAILED', `${mutation.id} workspace cleanup failed`);
    if (repository.status !== 'PASS' && !failure) {
      failure = new VerifierError('SOURCE_RESTORATION_FAILED', `${mutation.id} protected repository source changed`, { repository });
    }
    if (failure) {
      failure.cleanup = cleaned ? 'PASS' : 'FAIL';
      failure.details = { ...failure.details, repository_restoration: repository.status };
    }
  }
  if (failure) throw failure;
  return {
    ...evidence,
    restoration: restored ? 'PASS' : 'FAIL',
    workspace_cleanup: cleaned ? 'PASS' : 'FAIL',
    cleanup: cleaned ? 'PASS' : 'FAIL',
    final_result: restored && cleaned ? 'PASS' : 'FAIL'
  };
}

function runUnrelatedFailureControl(m31) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'tecm-teacher-attendance-unrelated-'));
  let failure;
  let cleaned = false;
  try {
    copyFixture(tempRoot);
    const testFile = resolve(tempRoot, testPath);
    const original = readFileSync(testFile);
    const shape = textShape(original);
    const normalized = shape.text.replace(/\r\n/g, '\n');
    writeFileSync(testFile, encodeText(
      `${normalized}\ntest('unrelated mutation control', () => { throw new Error('UNRELATED_CONTROL_FAILURE'); });\n`,
      shape
    ));
    const result = runTest(tempRoot);
    const classification = testFailureClassification(result, m31);
    if (classification.caught) {
      throw new VerifierError('UNRELATED_FAILURE_COUNTED', 'An unrelated failure was incorrectly counted as M31 CAUGHT', { classification });
    }
    throw new VerifierError('WRONG_FAILURE_CLASSIFICATION', 'Unrelated failure correctly rejected as M31 evidence', { classification });
  } catch (error) {
    failure = error instanceof VerifierError ? error : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
    if (failure) failure.cleanup = cleaned ? 'PASS' : 'FAIL';
  }
  throw failure;
}

function controlMode(name) {
  const m31 = cases.find(({ id }) => id === 'M31');
  const m40 = cases.find(({ id }) => id === 'M40');
  runBaseline();
  if (name === 'zero-match') {
    return runMutation({ ...m31, search: '__M31_ZERO_MATCH_CONTROL__' });
  }
  if (name === 'multiple-match') {
    return runMutation(m31, {
      fixtureTransform: (bytes, mutation) => {
        const shape = textShape(bytes);
        const normalized = shape.text.replace(/\r\n/g, '\n');
        return encodeText(`${normalized}\n${mutation.search}\n`, shape);
      }
    });
  }
  if (name === 'unrelated-failure') return runUnrelatedFailureControl(m31);
  if (name === 'lf') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'LF') });
  if (name === 'crlf') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'CRLF') });
  if (name === 'utf8-bom') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'LF', true) });
  if (name === 'restoration-mismatch') return runMutation(m31, { injectRestorationMismatch: true });
  if (name === 'm40-zero-match') {
    return runMutation({ ...m40, search: '__M40_ZERO_MATCH_CONTROL__' });
  }
  if (name === 'm40-multiple-match') {
    return runMutation(m40, {
      fixtureTransform: (bytes, mutation) => {
        const shape = textShape(bytes);
        const normalized = shape.text.replace(/\r\n/g, '\n');
        return encodeText(`${normalized}\n${mutation.search}\n`, shape);
      }
    });
  }
  throw new VerifierError('UNKNOWN_CONTROL', `Unknown M31 control: ${name}`);
}

function parseJsonLine(output) {
  const lines = output.split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try { return JSON.parse(line); } catch { /* continue */ }
  }
  return null;
}

function runM31Controls() {
  const controls = [
    { name: 'zero-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'multiple-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'unrelated-failure', exit: 'nonzero', code: 'WRONG_FAILURE_CLASSIFICATION' },
    { name: 'lf', exit: 'zero' },
    { name: 'crlf', exit: 'zero' },
    { name: 'utf8-bom', exit: 'zero' },
    { name: 'restoration-mismatch', exit: 'nonzero', code: 'RESTORATION_MISMATCH' },
    { name: 'm40-zero-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'm40-multiple-match', exit: 'nonzero', code: 'MATCH_COUNT' }
  ];
  return controls.map((control) => {
    const child = spawnSync(process.execPath, [resolve(repoRoot, verifierPath), `--control=${control.name}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 45_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const result = parseJsonLine(outputOf(child));
    const timedOut = child.error?.code === 'ETIMEDOUT';
    const exitCorrect = control.exit === 'zero' ? child.status === 0 : child.status !== 0;
    const codeCorrect = control.code ? result?.code === control.code : result?.result === 'passed';
    const cleanupCorrect = result?.cleanup === 'PASS';
    if (timedOut || child.signal || !exitCorrect || !codeCorrect || !cleanupCorrect) {
      throw new VerifierError('NEGATIVE_CONTROL_FAILED', `M31 ${control.name} control did not fail closed`, {
        control: control.name,
        exit_code: child.status,
        timed_out: timedOut,
        signal: child.signal ?? null,
        result
      });
    }
    return {
      control: control.name,
      result: 'PASS',
      observed_exit: child.status,
      observed_code: result.code ?? null,
      cleanup: result.cleanup
    };
  });
}

function successOutput(payload) {
  const restoration = repoRestorationEvidence();
  if (restoration.status !== 'PASS') {
    throw new VerifierError('SOURCE_RESTORATION_FAILED', 'Protected repository source changed', { restoration });
  }
  const usedDatabaseVerifier = payload.cases?.some((entry) => entry.database_cleanup === 'PASS') ?? false;
  process.stdout.write(`${JSON.stringify({
    result: 'passed',
    ...payload,
    restoration,
    cleanup: 'PASS',
    resources: {
      databases: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
      containers: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
      sidecars: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
      volumes: 'NOT_CREATED',
      workspaces: 'REMOVED'
    }
  })}\n`);
}

function runM40ProvenanceControl(mutation, databaseBaseline) {
    const provenance = runDatabaseMutation(mutation, {
      controlId: 'R3-F-UNKNOWN-DIAGNOSTIC-PROVENANCE', traceMode: 'unknown', baselineEvidence: databaseBaseline,
      expectedTraceDiagnosticCount: 2,
      expectedCaught: false,
      expectedRejectionCodes: ['M40_LOWER_CLASSIFIER_REJECTED', 'M40_TRACE_DIAGNOSTIC_UNCLASSIFIED'],
      competitorMutation: { id: 'R3-F', search: "\\echo @@TECM_M40_PHASE@@rpc_timeout_armed\nset statement_timeout = '3s';",
        replacement: "select pg_sleep(3.25);\n\\echo @@TECM_M40_PHASE@@rpc_timeout_armed\nset statement_timeout = '3s';" }
    });
    const unknowns = provenance.diagnostic_trace.diagnostics.filter(e => e.classification === 'unclassified_diagnostic');
    const stdoutCanary = unknowns.filter(e => e.stream === 'stdout');
    const stderrCanary = unknowns.filter(e => e.stream === 'stderr');
    if (unknowns.length !== 2 || stdoutCanary.length !== 1 || stderrCanary.length !== 1
        || unknowns.some(e => e.phase !== 'slow_setup_completed' || e.source !== 'competitor')
        || stdoutCanary[0].digest !== sha256(Buffer.from('ERROR: R3_STDOUT_CANARY'))
        || stderrCanary[0].digest !== sha256(Buffer.from('ERROR: R3_STDERR_CANARY'))) {
      throw new VerifierError('R3_F_PROVENANCE_FAILED', 'Unknown diagnostic provenance did not match', {
        metadata: unknowns, stdout_count: stdoutCanary.length, stderr_count: stderrCanary.length });
    }
  return provenance;
}

function runM40NoticeContractControls() {
  // Static fixtures exercise the contract. They are never runtime baseline proof.
  const lines = [...approvedPreterminalNotices.keys()];
  const controls = [];
  for (const [id, input, expected] of [
    ['approved', lines, true],
    ['message-replaced', [lines[0].replace(/NOTICE:  .+$/, 'NOTICE:  UNEXPECTED_BASELINE_NOTICE'), ...lines.slice(1)], false],
    ['duplicate-substitution', [lines[1], ...lines.slice(1)], false],
    ['missing', lines.slice(1), false],
    ['extra', [...lines, lines[0]], false],
    ['line-replaced', [lines[0].replace(/:\d+: NOTICE:/, ':9999: NOTICE:'), ...lines.slice(1)], false],
    ['severity-replaced', [lines[0].replace(': NOTICE:', ': WARNING:'), ...lines.slice(1)], false]
  ]) {
    const profile = diagnosticFingerprintProfile(input.join('\n'), { requireCompleteVerifierShape: true });
    if ((profile.safe && profile.complete_verifier_shape) !== expected) throw new VerifierError('M40_NOTICE_CONTRACT_CONTROL_FAILED', id, profile);
    controls.push({ id: 'M40-F2-' + id, passed: true, scope: m40AcceptanceMode ? 'm40-acceptance' : 'repository-database',
      expected_safe: expected, observed_safe: profile.safe, complete_shape: profile.complete_verifier_shape, rejection_codes: profile.rejection_codes });
  }
  for (const [id, text, accepted] of [
    ['separate-objects', '{"a":{"key":1},"b":{"key":2}}', true],
    ['strings-and-escapes', '{"a":"brace } and quote \\\"","b":[true,false,null,-1.2e3]}', true],
    ['duplicate', '{"key":1,"key":2}', false],
    ['escaped-key', '{"key":1,"\\u006bey":2}', false],
    ['nested', '{"a":[{"key":1,"key":2}]}', false],
    ['trailing-comma', '{"a":1,}', false],
    ['depth', '['.repeat(34) + '0' + ']'.repeat(34), false]
  ]) {
    let observed = true;
    try { parseM40Json(text); } catch { observed = false; }
    if (observed !== accepted) throw new VerifierError('M40_JSON_CONTRACT_CONTROL_FAILED', id);
    controls.push({ id: 'M40-F1-JSON-' + id, passed: true, expected_accepted: accepted, observed_accepted: observed });
  }
  return controls;
}

function m40Stage(name, execute) {
  saveR4AttemptEvidence('stage-' + name + '-start', { name, started_at: new Date().toISOString() });
  try {
    const result = execute();
    saveR4AttemptEvidence('stage-' + name + '-pass', result);
    return result;
  } catch (error) {
    saveR4AttemptEvidence('stage-' + name + '-failure', { code: error.code, message: error.message, details: error.details, cleanup: error.cleanup });
    throw error;
  }
}

function runM40AdditionalSafetyControls(mutation, baselineEvidence) {
  const common = { baselineEvidence, expectedCaught: false, requiredObservedSqlState: '57014', requiredSemanticCandidate: true,
    expectedSemanticSignatures: ['m40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false'] };
  const witness = m40Stage('missing-lock-witness', () => runDatabaseMutation(mutation, {
    ...common, controlId: 'M40-MISSING-LOCK-WITNESS',
    expectedRejectionCodes: ['M40_HOLDER_JOB_FAILED','M40_LIFECYCLE_FAILURE_OBSERVED','M40_LOWER_CLASSIFIER_REJECTED'],
    requiredLifecycle: { semantic_candidate:'PASS', post_candidate_assertion:'PASS', holder_release:'PASS',
      holder_terminal:'FAIL', competitor_terminal:'PASS', jobs_stopped:'NOT_REQUIRED', jobs_removed:'PASS', barrier_cleanup:'PASS', finalization:'FAIL' },
    holderMutation: { id: 'M40-MISSING-LOCK-WITNESS', search: 'and not w.granted', replacement: 'and false and not w.granted' }
  }));
  const error = m40Stage('mixed-job-error', () => runDatabaseMutation(mutation, {
    ...common, controlId: 'M40-MIXED-JOB-ERROR',
    expectedRejectionCodes: ['M40_COMPETITOR_JOB_RECEIVE_FAILED','M40_LIFECYCLE_FAILURE_OBSERVED','M40_LOWER_CLASSIFIER_REJECTED'],
    requiredLifecycle: { semantic_candidate:'PASS', post_candidate_assertion:'PASS', holder_release:'PASS',
      holder_terminal:'PASS', competitor_terminal:'FAIL', jobs_stopped:'NOT_REQUIRED', jobs_removed:'PASS', barrier_cleanup:'PASS', finalization:'FAIL' },
    verifierMutation: { id: 'M40-MIXED-JOB-ERROR', search: '        $workerOutput\n      } -ArgumentList',
      replacement: "        Write-Error 'M40_JOB_ERROR_CANARY' -ErrorAction Continue\n        $workerOutput\n      } -ArgumentList" }
  }));
  return [witness,error];
}

function main() {
  if (process.argv.includes('--m40-safety-controls')) {
    const baseline = m40Stage('database-baseline', runDatabaseBaseline);
    const safety = runM40AdditionalSafetyControls(cases.find(c => c.id === 'M40'), baseline);
    successOutput({ stage: 'M40 additional safety regressions', database_baseline: baseline, safety });
    return;
  }
  if (process.argv.includes('--m40-acceptance')) {
    if (!requestedEvidenceRoot) throw new Error('M40 acceptance requires TECM_M40_EVIDENCE_ROOT');
    const identityFiles = [...new Set([...sourceFiles, verifierPath, 'scripts/testing/m40-packet-controls.ps1',
      'scripts/testing/batch1-release-blockers-mutation-verify.mjs', 'scripts/testing/validate-release-workflow.mjs'])];
    const identity = Object.fromEntries(identityFiles.map(file => [file, sha256(readFileSync(resolve(repoRoot, file)))]));
    saveR4AttemptEvidence('candidate', { files: identity, entrypoint: '--m40-acceptance' });
    const acceptanceScope = {
      entrypoint: '--m40-acceptance', database_scope: 'M40Acceptance',
      order: ['cheap checks', 'baseline', 'positive controls', 'negative controls', 'cleanup'],
      safety_gate: ['independent baseline', 'slow', 'genuine', 'pre-rpc', 'lifecycle-A/B/C',
        'missing-lock-witness', 'mixed-job-error', 'terminal', 'sql', 'different-mutation', 'provenance', 'cleanup'],
      harness_self_tests: ['packet', 'supervisory', 'collector', 'S5', 'construction',
        'producer', 'diagnostic', 'classification', 'target-count'],
      repository_workflow: { gates_m40: false, full_guard: 'NOT RUN' },
      not_covered: ['full Teacher mutation suite', 'full repository database suite',
        'APNS business suites and unrelated business races', 'full release workflow guard', 'merge/release approval']
    };
    saveR4AttemptEvidence('acceptance-scope', acceptanceScope);
    const packetControls = m40Stage('packet', () => {
      const result = spawnSync('pwsh', ['-NoProfile','-File',resolve(repoRoot,'scripts/testing/m40-packet-controls.ps1')],
        { cwd: repoRoot, encoding: 'utf8', timeout: 30000, windowsHide: true });
      saveR4AttemptEvidence('packet-process', result);
      if (result.status !== 0 || result.error || result.signal || result.stderr.trim()) throw new VerifierError('M40_PACKET_CONTROLS_FAILED', 'Packet regressions failed', result);
      return JSON.parse(result.stdout);
    });
    const supervisory = m40Stage('supervisory', () => [...runM40SupervisoryStaticControls({ requireRepositoryWorkflow: false }), ...runM40SupervisorySyntheticControls()]);
    const collector = m40Stage('collector', runR4SyntheticControls);
    supervisory.push(m40Stage('S5', () => {
      if (!collector.passed || !collector.h1_h8.every(c => c.passed)) throw new Error('M40_S5_FAILED');
      return { id: 'S5', passed: true, outer_protocol: collector.outer_protocol,
        source_restoration: collector.source_restoration, workspace_cleanup: collector.workspace_cleanup };
    }));
    const construction = m40Stage('construction', runR3ConstructionControls);
    const mutation = cases.find(({ id }) => id === 'M40');
    m40Stage('teacher-baseline', runBaseline);
    const databaseBaseline = m40Stage('database-baseline', runDatabaseBaseline);
    const slow = m40Stage('slow', () => runM40TimeoutScopeControls(mutation, databaseBaseline, 'slow-pre-rpc')[0]);
    const genuine = m40Stage('genuine', () => runM40LifecycleControls(mutation, databaseBaseline, 'D')[0]);
    // These cheap negative controls consume the independent baseline's fingerprints.
    const producer = m40Stage('producer', () => runNegativePreflightProducerControls(databaseBaseline));
    const diagnostic = m40Stage('diagnostic', () => runM40DiagnosticSafetyControls(databaseBaseline));
    const classification = m40Stage('classification', () => runDatabaseClassificationControls(mutation, databaseBaseline));
    const targetCount = m40Stage('target-count', () => runM40TargetCountControls(databaseBaseline));
    const preRpc = m40Stage('pre-rpc', () => runM40TimeoutScopeControls(mutation, databaseBaseline, 'pre-rpc-57014')[0]);
    const lifecycle = ['A','B','C'].map(id => m40Stage('lifecycle-' + id, () => runM40LifecycleControls(mutation, databaseBaseline, id)[0]));
    const additionalSafety = runM40AdditionalSafetyControls(mutation, databaseBaseline);
    const terminal = m40Stage('terminal', () => runM40TerminalControls(mutation, databaseBaseline, null, genuine));
    const sql = m40Stage('sql', () => runM40SqlControls(mutation, databaseBaseline));
    const different = m40Stage('different-mutation', () => runM40DifferentMutationControl(databaseBaseline));
    const provenance = m40Stage('provenance', () => runM40ProvenanceControl(mutation, databaseBaseline));
    if (Object.entries(identity).some(([file, hash]) => sha256(readFileSync(resolve(repoRoot,file))) !== hash)) {
      throw new VerifierError('M40_CANDIDATE_CHANGED', 'Candidate changed during acceptance');
    }
    successOutput({ stage: 'M40 acceptance with incremental evidence', acceptance_scope: acceptanceScope,
      cases: [genuine], candidate: identity,
      database_baseline: databaseBaseline, packet_controls: packetControls, supervisory, collector, construction,
      producer, diagnostic, classification, target_count: targetCount, slow, pre_rpc: preRpc, lifecycle,
      additional_safety: additionalSafety, terminal, sql, different_mutation: different, provenance, database_probe_count: databaseProbeNumber });
    return;
  }

  if (process.argv.includes('--negative-preflight-controls')) {
    successOutput({ negative_preflight_producer_controls: runNegativePreflightProducerControls() });
    return;
  }
  const control = process.argv.find((argument) => argument.startsWith('--control='))?.split('=')[1];
  if (control) {
    const evidence = controlMode(control);
    successOutput({ control, evidence });
    return;
  }
  if (process.argv.includes('--m31-controls')) {
    successOutput({ controls: runM31Controls() });
    return;
  }
  if (process.argv.includes('--m40-classifier-controls')) {
    runBaseline();
    successOutput({
      database_controls: runDatabaseClassificationControls(
        cases.find(({ id }) => id === 'M40'),
        { passed: true }
      )
    });
    return;
  }
  if (process.argv.includes('--m40-diagnostic-controls')) {
    runBaseline();
    const databaseBaseline = runDatabaseBaseline();
    successOutput({
      stage: 'M40 stderr attribution and terminal mechanism controls',
      database_baseline: databaseBaseline,
      negative_preflight_producer_controls: runNegativePreflightProducerControls(databaseBaseline),
      diagnostic_controls: runM40DiagnosticSafetyControls(databaseBaseline)
    });
    return;
  }
  if (process.argv.includes('--m40-terminal-contract-controls')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const terminalContractControlIds = [
      'CONTROL-M40-EXPECTED-SIDECAR',
      'CONTROL-M40-TERMINAL-BEFORE-CLEANUP',
      'CONTROL-M40-TERMINAL-SUCCESS-STATUS-ZERO',
      'CONTROL-M40-THROW-TEXT-NOT-SEMANTIC-AUTHORITY',
      'CONTROL-M40-DATABASE-CLEANUP-FAILURE',
      'CONTROL-M40-SEMANTIC-REJECTION-NOT-LIFECYCLE-FAILURE'
    ];
    successOutput({
      stage: 'M40 terminal contract controls',
      normal_verifier: databaseBaseline,
      negative_preflight_producer_controls: runNegativePreflightProducerControls(databaseBaseline),
      diagnostic_controls: runM40DiagnosticSafetyControls(databaseBaseline),
      terminal_contract_controls: runDatabaseClassificationControls(
        mutation,
        databaseBaseline,
        terminalContractControlIds
      ),
      release_guard_topology_controls: [
        'CONTROL-ROOT-EXIT-BEFORE-BATCH1-SETUP',
        'CONTROL-UNCONDITIONAL-RETURN-BEFORE-BATCH1-SETUP',
        'CONTROL-RETURN-BETWEEN-STAFF-RACES',
        'CONTROL-HIDDEN-ENV-SHORT-CIRCUIT',
        'CONTROL-COMMAND-DYNAMIC-PROVIDER',
        'CONTROL-UNEXPECTED-EXIT-THROW-UNINVOKED-SCRIPTBLOCK'
      ]
    });
    return;
  }
  if (process.argv.includes('--r4-controls')) {
    const supervisory = [...runM40SupervisoryStaticControls(), ...runM40SupervisorySyntheticControls()];
    const synthetic = runR4SyntheticControls();
    supervisory.push({ id: 'S5', passed: synthetic.passed && synthetic.h1_h8.every(c => c.passed),
      outer_protocol: synthetic.outer_protocol, source_restoration: synthetic.source_restoration,
      workspace_cleanup: synthetic.workspace_cleanup });
    saveR4AttemptEvidence('S5', supervisory.at(-1));
    successOutput({ cases: [], stage: 'M40 supervisory S1-S5 and collector H1-H8 controls',
      supervisory_s1_s5: supervisory, r4_a_b: synthetic });
    return;
  }
  if (process.argv.includes('--r4-real-diagnostic')) {
    const mutation = cases.find(({ id }) => id === 'M40');
    const arm = "\\echo @@TECM_M40_PHASE@@rpc_timeout_armed\nset statement_timeout = '3s';";
    const diagnostic = runDatabaseMutation(mutation, { controlId: 'M40-REAL-SLOW-PRE-RPC-SETUP', traceMode: 'slow', diagnosticOnly: true,
      competitorMutation: { id: 'M40-REAL-SLOW-PRE-RPC-SETUP', search: arm, replacement: 'select pg_sleep(3.25);\n' + arm } });
    successOutput({ cases: [], stage: 'R4 development diagnostic only', r4_c_d: diagnostic });
    return;
  }
  if (process.argv.includes('--r3-controls')) {
    const constructionControls = runR3ConstructionControls();
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const positive = runM40TimeoutScopeControls(mutation, databaseBaseline, 'slow-pre-rpc')[0];
    const negative = runM40TimeoutScopeControls(mutation, databaseBaseline, 'pre-rpc-57014')[0];
    const provenance = runM40ProvenanceControl(mutation, databaseBaseline);
    const diagnosticOnly = databaseFailureClassification({ status: 1, stdout: '[CLEANUP] database=PASS container=PASS\n', stderr: '',
      m40_trace: positive.diagnostic_trace }, mutation);
    if (diagnosticOnly.caught || diagnosticOnly.exact_semantic_classification) throw new VerifierError('R3_TRACE_AUTHORITY_FAILED', 'Diagnostic evidence gained semantic authority');
    successOutput({ cases: [positive], stage: 'R3 dedicated controls', database_baseline: databaseBaseline,
      r3_a_e: constructionControls, r3_c: positive, r3_d: negative, r3_f: provenance,
      r3_g: positive.trace_tamper_controls, trace_is_semantic_authority: false });
    return;
  }
  if (process.argv.includes('--m40-terminal-controls')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const exactPositive = runM40LifecycleControls(mutation, databaseBaseline, 'D')[0];
    const classifierControls = runDatabaseClassificationControls(mutation, databaseBaseline)
      .filter(({ id }) => id.includes('R2-A') || id.includes('R2-F'));
    const terminalControls = runM40TerminalControls(mutation, databaseBaseline, null, exactPositive);
    successOutput({
      cases: [exactPositive],
      stage: 'M40 R2 terminal controls',
      database_baseline: databaseBaseline,
      focused_genuine_m40: exactPositive,
      negative_preflight_producer_controls: runNegativePreflightProducerControls(databaseBaseline),
      diagnostic_controls: runM40DiagnosticSafetyControls(databaseBaseline),
      r2_stream_record_controls: classifierControls,
      r2_terminal_controls: terminalControls
    });
    return;
  }
  if (process.argv.includes('--m40-runtime-sequence') || process.argv.includes('--focused-acceptance')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const producerControls = runNegativePreflightProducerControls(databaseBaseline);
    const diagnosticControls = runM40DiagnosticSafetyControls(databaseBaseline);
    const focusedM40 = runM40LifecycleControls(mutation, databaseBaseline, 'D')[0];
    const controlA = runM40LifecycleControls(mutation, databaseBaseline, 'A')[0];
    const controlB = runM40LifecycleControls(mutation, databaseBaseline, 'B')[0];
    const controlC = runM40LifecycleControls(mutation, databaseBaseline, 'C')[0];
    const slowPreRpc = runM40TimeoutScopeControls(mutation, databaseBaseline, 'slow-pre-rpc')[0];
    const preRpc57014 = runM40TimeoutScopeControls(mutation, databaseBaseline, 'pre-rpc-57014')[0];
    const sidecarLifecycleControls = runDatabaseClassificationControls(mutation, databaseBaseline);
    const terminalControls = runM40TerminalControls(mutation, databaseBaseline, null, focusedM40);
    const sqlControls = runM40SqlControls(mutation, databaseBaseline);
    const targetCountControls = runM40TargetCountControls(databaseBaseline);
    successOutput({
      cases: [focusedM40],
      stage: 'focused M40 runtime sequence',
      database_baseline: databaseBaseline,
      negative_preflight_producer_controls: producerControls,
      diagnostic_controls: diagnosticControls,
      focused_genuine_m40: focusedM40,
      control_a: controlA,
      control_b: controlB,
      control_c: controlC,
      slow_pre_rpc_control: slowPreRpc,
      pre_rpc_57014_control: preRpc57014,
      sidecar_lifecycle_controls: sidecarLifecycleControls,
      r2_terminal_controls: terminalControls,
      sql_controls: sqlControls,
      target_count_controls: targetCountControls
    });
    return;
  }
  if (process.argv.includes('--post-suite-focused-m40')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const evidence = runM40LifecycleControls(mutation, databaseBaseline, 'D')[0];
    successOutput({
      cases: [evidence],
      stage: 'post-suite focused M40',
      database_baseline: databaseBaseline,
      post_suite_focused_m40: evidence
    });
    return;
  }
  const runtimeControl = process.argv.find((argument) => argument.startsWith('--m40-runtime-control='))?.split('=')[1];
  if (runtimeControl) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const lifecycleControls = new Set(['A', 'B', 'C', 'D']);
    const terminalControls = new Set(['R2-B', 'R2-C', 'R2-D', 'R2-E']);
    const sqlControls = new Set(['M40-REAL-FORGED-RECORD-UNRELATED-SQL', 'M40-REAL-MARKER-PLUS-VALID-BLOCK']);
    const timeoutControls = new Set(['slow-pre-rpc', 'pre-rpc-57014']);
    let evidence;
    if (lifecycleControls.has(runtimeControl)) {
      evidence = runM40LifecycleControls(mutation, databaseBaseline, runtimeControl)[0];
    } else if (terminalControls.has(runtimeControl)) {
      evidence = runM40TerminalControls(mutation, databaseBaseline, runtimeControl)[0];
    } else if (sqlControls.has(runtimeControl)) {
      evidence = runM40SqlControls(mutation, databaseBaseline, runtimeControl)[0];
    } else if (timeoutControls.has(runtimeControl)) {
      evidence = runM40TimeoutScopeControls(mutation, databaseBaseline, runtimeControl)[0];
    } else {
      throw new VerifierError('UNKNOWN_M40_RUNTIME_CONTROL', `Unknown M40 runtime control: ${runtimeControl}`);
    }
    successOutput({
      cases: [evidence],
      stage: `focused M40 runtime control ${runtimeControl}`,
      database_baseline: databaseBaseline,
      evidence
    });
    return;
  }
  const focused = process.argv.find((argument) => argument.startsWith('--case='))?.split('=')[1];
  runBaseline();
  const selected = focused ? cases.filter(({ id }) => id === focused) : cases;
  if (selected.length === 0) throw new VerifierError('UNKNOWN_MUTATION', `Unknown mutation case: ${focused}`);
  const needsDatabase = selected.some(({ databaseProbe }) => databaseProbe);
  const databaseBaseline = needsDatabase ? runDatabaseBaseline() : null;
  const databaseControls = needsDatabase
    ? runDatabaseClassificationControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40LifecycleControls = needsDatabase
    ? runM40LifecycleControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40TerminalControlEvidence = needsDatabase
    ? runM40TerminalControls(
      cases.find(({ id }) => id === 'M40'),
      databaseBaseline,
      null,
      m40LifecycleControls.find(({ control }) => control === 'D')
    )
    : null;
  const m40DiagnosticControls = needsDatabase
    ? runM40DiagnosticSafetyControls(databaseBaseline)
    : null;
  const negativePreflightProducerControls = needsDatabase
    ? runNegativePreflightProducerControls(databaseBaseline)
    : null;
  const m40TargetCountControls = needsDatabase ? runM40TargetCountControls(databaseBaseline) : null;
  const m40SqlControls = needsDatabase
    ? runM40SqlControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40TimeoutScopeControls = needsDatabase
    ? runM40TimeoutScopeControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40DifferentMutationControl = needsDatabase
    ? runM40DifferentMutationControl(databaseBaseline)
    : null;
  const controls = focused ? null : runM31Controls();
  const evidence = selected.map((mutation) => runMutation(
    mutation,
    mutation.databaseProbe ? { baselineEvidence: databaseBaseline } : {}
  ));
  successOutput({
    cases: evidence,
    controls,
    database_baseline: databaseBaseline,
    database_controls: databaseControls,
    m40_lifecycle_controls: m40LifecycleControls,
    m40_terminal_controls: m40TerminalControlEvidence,
    m40_diagnostic_controls: m40DiagnosticControls,
    negative_preflight_producer_controls: negativePreflightProducerControls,
    m40_target_count_controls: m40TargetCountControls,
    m40_sql_controls: m40SqlControls,
    m40_timeout_scope_controls: m40TimeoutScopeControls,
    m40_different_mutation_control: m40DifferentMutationControl
  });
}

try {
  main();
} catch (error) {
  const failure = error instanceof VerifierError
    ? error
    : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  process.stderr.write(`${JSON.stringify({
    result: 'failed',
    code: failure.code,
    message: failure.message,
    details: failure.details,
    cleanup: failure.cleanup
  })}\n`);
  process.exitCode = 1;
}
