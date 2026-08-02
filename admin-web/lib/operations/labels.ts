const LABELS: Record<string, string> = {
  active: '使用中',
  inactive: '已停用',
  draft: '草稿',
  scheduled: '已排課',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '缺席未到',
  waived: '已豁免',
  present: '出席',
  absent: '缺席',
  excused: '已請假',
  makeup_completed: '已完成補課',
  approved: '已批准',
  rejected: '已拒絕',
  pending: '待處理',
  confirmed: '已確認',
  open: '待處理',
  done: '已完成',
  dismissed: '已忽略',
  recommended: '建議安排',
  withdrawn: '已退出',
  available: '可使用',
  unlinked: '未連結',
  invited: '已邀請',
  disabled: '已停用',
  reserved: '已預留',
  consumed: '已使用',
  expired: '已過期',
  received: '已收款',
  paid: '已付款',
  partially_paid: '部分付款',
  void: '已作廢',
  cash: '現金',
  card: '信用卡',
  bank_transfer: '銀行轉帳',
  digital_wallet: '電子錢包',
  other: '其他',
  purchase: '購買套票',
  attendance_deduction: '出席扣堂',
  adjustment: '人工作出調整',
  refund: '退款',
  reversal: '撤銷紀錄',
  queued: '排隊處理',
  sent: '已發送',
  failed: '失敗',
  announcement: '機構公告',
  class_reminder: '課堂提醒',
  attendance: '出席通知',
  leave: '請假通知',
  makeup: '補課通知',
  payments: '付款通知',
  marketing: '推廣訊息',
  transactional: '交易通知',
  security: '安全通知',
  normal: '一般',
  high: '高',
  urgent: '緊急',
  teacher: '導師',
  staff: '職員',
  admin: '管理員'
};

const OPERATION_LABELS: Record<string, string> = {
  claimed: '\u8655\u7406\u4e2d',
  processing: '\u8655\u7406\u4e2d',
  retry: '\u5f85\u91cd\u8a66',
  delivered: '\u5df2\u6295\u905e',
  would_send: '\u6a21\u64ec\u6295\u905e',
  dead_letter: '\u7121\u6cd5\u6295\u905e'
};

const LABEL_VALUES = new Set([...Object.values(LABELS), ...Object.values(OPERATION_LABELS)]);

export function statusLabel(value: string | null | undefined) {
  if (!value) return '—';
  if (LABEL_VALUES.has(value)) return value;
  return LABELS[value] ?? OPERATION_LABELS[value] ?? '未知狀態';
}

export function roleLabel(value: string | null | undefined) {
  return statusLabel(value);
}
