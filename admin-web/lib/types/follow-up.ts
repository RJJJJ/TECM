export type FollowUpChannel = 'wechat_manual' | 'whatsapp_manual' | 'phone_manual' | 'in_app';
export type FollowUpPriority = 'low' | 'medium' | 'high';
export type FollowUpStatus = 'open' | 'done' | 'dismissed';
export type FollowUpSource = 'automation' | 'staff' | 'manual_seed' | 'n8n';

export type FollowUpTask = {
  id: string;
  booking_id: string;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  course_title_snapshot: string | null;
  campus_name: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  channel: FollowUpChannel;
  priority: FollowUpPriority;
  intent_summary: string | null;
  suggested_message: string;
  suggested_next_steps: string[];
  internal_note: string | null;
  source: FollowUpSource;
  status: FollowUpStatus;
  completed_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowUpTaskInsert = {
  booking_id: string;
  parent_name?: string | null;
  phone?: string | null;
  child_name?: string | null;
  course_title_snapshot?: string | null;
  campus_name?: string | null;
  booking_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  channel?: FollowUpChannel;
  priority?: FollowUpPriority;
  intent_summary?: string | null;
  suggested_message: string;
  suggested_next_steps?: string[];
  internal_note?: string | null;
  source?: FollowUpSource;
  status?: FollowUpStatus;
  completed_at?: string | null;
  dismissed_at?: string | null;
};

export type FollowUpTaskUpdate = Partial<Omit<FollowUpTaskInsert, 'booking_id'>> & {
  status?: FollowUpStatus;
  completed_at?: string | null;
  dismissed_at?: string | null;
};

const badgeBase = 'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold';

export function followUpPriorityLabel(priority: FollowUpPriority | string | null) {
  switch (priority) {
    case 'high':
      return '高';
    case 'low':
      return '低';
    case 'medium':
      return '中';
    default:
      return '未知';
  }
}

export function followUpPriorityBadgeClass(priority: FollowUpPriority | string | null) {
  switch (priority) {
    case 'high':
      return `${badgeBase} border-rose-200 bg-rose-50 text-rose-700`;
    case 'low':
      return `${badgeBase} border-slate-200 bg-slate-50 text-slate-600`;
    case 'medium':
      return `${badgeBase} border-amber-200 bg-amber-50 text-amber-700`;
    default:
      return `${badgeBase} border-slate-200 bg-slate-100 text-slate-600`;
  }
}

export function followUpChannelLabel(channel: FollowUpChannel | string | null) {
  switch (channel) {
    case 'wechat_manual':
      return 'WeChat 人工跟進';
    case 'whatsapp_manual':
      return 'WhatsApp 人工跟進';
    case 'phone_manual':
      return '電話跟進';
    case 'in_app':
      return 'App 內通知';
    default:
      return '未知渠道';
  }
}

export function followUpStatusLabel(status: FollowUpStatus | string | null) {
  switch (status) {
    case 'open':
      return '待跟進';
    case 'done':
      return '已完成';
    case 'dismissed':
      return '已忽略';
    default:
      return '未知狀態';
  }
}

export function followUpStatusBadgeClass(status: FollowUpStatus | string | null) {
  switch (status) {
    case 'open':
      return `${badgeBase} border-blue-200 bg-blue-50 text-blue-700`;
    case 'done':
      return `${badgeBase} border-emerald-200 bg-emerald-50 text-emerald-700`;
    case 'dismissed':
      return `${badgeBase} border-slate-200 bg-slate-50 text-slate-600`;
    default:
      return `${badgeBase} border-slate-200 bg-slate-100 text-slate-600`;
  }
}
