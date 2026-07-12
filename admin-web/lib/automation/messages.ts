export const OPERATION_JOB_TYPES = [
  'morning_summary',
  'evening_summary',
  'low_credit',
  'overdue_payment',
  'unassigned_makeup',
  'weekly_report'
] as const;

export type OperationJobType = (typeof OPERATION_JOB_TYPES)[number];

const JOB_LABELS: Record<OperationJobType, string> = {
  morning_summary: '早上課堂及待辦摘要',
  evening_summary: '晚上點名及請假摘要',
  low_credit: '堂數不足跟進',
  overdue_payment: '欠費跟進',
  unassigned_makeup: '未安排補課提醒',
  weekly_report: '每週營運報告'
};

export function isOperationJobType(value: unknown): value is OperationJobType {
  return typeof value === 'string' && OPERATION_JOB_TYPES.includes(value as OperationJobType);
}

export function defaultPeriodKey(jobType: OperationJobType, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  if (jobType !== 'weekly_report') return day;

  const date = new Date(`${day}T00:00:00+08:00`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function deterministicAutomationMessage(jobType: OperationJobType, periodKey: string, createdCount: number) {
  const label = JOB_LABELS[jobType];
  return `${label}（${periodKey}）已完成。系統建立或更新 ${createdCount} 項內部跟進；請職員核對內容後，才人工複製到 WhatsApp／WeChat。`;
}

