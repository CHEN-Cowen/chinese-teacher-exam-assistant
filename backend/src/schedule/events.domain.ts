/**
 * 日程与通知领域类型（v6.1 模块 6）。
 *
 * 事件由已发布公告版本的 timeline 派生，按“用户关注的报考单元”落库。
 * eventKey = `${unitId}-${kind}` 在同一用户下唯一，保证同一公告版本
 * 重复同步不产生重复事件；新版本变更时间时更新同一记录并追加 changeHistory。
 */

/**
 * 时间线事件类型（与公告 timeline 字段一一对应；不凭空发明无数据节点）。
 * M7 节点范围：报名开始/截止、资格初审、审核结果、缴费截止、改报截止、
 * 准考证打印开始/截止、笔试、成绩查询/复核、资格复审、面试确认、面试、
 * 体检、考察、选岗、拟聘用公示。
 */
export type TimelineEventKind =
  | 'registration_start'
  | 'registration_end'
  | 'preliminary_review'
  | 'review_result'
  | 'payment'
  | 'amendment_deadline'
  | 'admit_ticket'
  | 'admit_ticket_end'
  | 'written_exam'
  | 'score'
  | 'score_review'
  | 'qualification_review'
  | 'interview_confirm'
  | 'interview'
  | 'medical_exam'
  | 'inspection'
  | 'position_selection'
  | 'publication'
  | 'pending_notice';

/** 通知分级（docs IA 第 5 节） */
export type NotificationSeverity = 'must_handle' | 'suggest_handle' | 'info';

/** 日程展示强度（前端视觉：must=必须处理/suggest=建议处理/info=普通信息） */
export type ScheduleUrgency = 'must' | 'suggest' | 'info';

export interface TimelineChangeRecord {
  versionId: string;
  dateIso: string | null;
  title: string;
  changedAt: string;
}

/** 从公告版本派生的原始事件（未落库） */
export interface RawTimelineEvent {
  eventKey: string;
  kind: TimelineEventKind;
  title: string;
  /** ISO 日期；待官方通知时为 null，绝不写推测日期 */
  dateIso: string | null;
}

/** 事件中文标签 */
export const KIND_LABELS: Record<TimelineEventKind, string> = {
  registration_start: '报名开始',
  registration_end: '报名截止',
  preliminary_review: '资格初审',
  review_result: '审核结果',
  payment: '缴费截止',
  amendment_deadline: '改报截止',
  admit_ticket: '准考证打印开始',
  admit_ticket_end: '准考证打印截止',
  written_exam: '笔试',
  score: '成绩查询',
  score_review: '成绩复核',
  qualification_review: '资格复审',
  interview_confirm: '面试确认',
  interview: '面试',
  medical_exam: '体检',
  inspection: '考察',
  position_selection: '选岗',
  publication: '拟聘用公示',
  pending_notice: '待官方通知',
};

/** 扩展后的公告 timeline 字段集（M7 全部节点） */
export interface AnnouncementTimelineFields {
  registrationStart?: string;
  registrationEnd?: string;
  preliminaryReviewDate?: string;
  reviewResultDate?: string;
  paymentDeadline?: string;
  amendmentDeadline?: string;
  admitTicketStart?: string;
  admitTicketEnd?: string;
  writtenExamDate?: string;
  scoreDate?: string;
  scoreReviewDate?: string;
  qualificationReviewDate?: string;
  interviewConfirmDate?: string;
  interviewDate?: string;
  medicalExamDate?: string;
  inspectionDate?: string;
  positionSelectionDate?: string;
  publicationDate?: string;
  pendingItems?: string[];
}

/**
 * 从公告版本 timeline 生成事件列表。
 * - 时间未定的字段直接跳过（不生成伪精确事件）；
 * - pendingItems 生成 dateIso=null 的 pending_notice 事件。
 * - 每种节点对应一个固定 eventKey，跨版本按 eventKey 对齐。
 */
export function generateEvents(
  unitId: string,
  timeline: AnnouncementTimelineFields,
): RawTimelineEvent[] {
  const events: RawTimelineEvent[] = [];

  const fieldMap: Array<[string, TimelineEventKind]> = [
    ['registrationStart', 'registration_start'],
    ['registrationEnd', 'registration_end'],
    ['preliminaryReviewDate', 'preliminary_review'],
    ['reviewResultDate', 'review_result'],
    ['paymentDeadline', 'payment'],
    ['amendmentDeadline', 'amendment_deadline'],
    ['admitTicketStart', 'admit_ticket'],
    ['admitTicketEnd', 'admit_ticket_end'],
    ['writtenExamDate', 'written_exam'],
    ['scoreDate', 'score'],
    ['scoreReviewDate', 'score_review'],
    ['qualificationReviewDate', 'qualification_review'],
    ['interviewConfirmDate', 'interview_confirm'],
    ['interviewDate', 'interview'],
    ['medicalExamDate', 'medical_exam'],
    ['inspectionDate', 'inspection'],
    ['positionSelectionDate', 'position_selection'],
    ['publicationDate', 'publication'],
  ];

  for (const [field, kind] of fieldMap) {
    const dateIso = (timeline as Record<string, string | undefined>)[field];
    if (dateIso) {
      events.push({
        eventKey: `${unitId}-${kind}`,
        kind,
        title: KIND_LABELS[kind],
        dateIso,
      });
    }
  }

  for (const [index, item] of (timeline.pendingItems ?? []).entries()) {
    events.push({
      eventKey: `${unitId}-pending_notice-${index}`,
      kind: 'pending_notice',
      title: item,
      dateIso: null,
    });
  }

  return events;
}

/**
 * 根据事件类型与距今天数推导展示强度（不写库，查询时计算）。
 * - 报名/缴费/改报截止在 7 天内 → must；
 * - 笔试/面试/资格复审/准考证在 14 天内 → suggest；
 * - 其余为 info；已过去的事件统一按 info 展示。
 */
export function urgencyOf(
  kind: TimelineEventKind,
  daysUntil: number | null,
): ScheduleUrgency {
  if (daysUntil === null || daysUntil < 0) return 'info';
  const MUST_KINDS: TimelineEventKind[] = [
    'registration_end',
    'payment',
    'amendment_deadline',
    'admit_ticket_end',
  ];
  if (MUST_KINDS.includes(kind) && daysUntil <= 7) return 'must';
  const SUGGEST_KINDS: TimelineEventKind[] = [
    'written_exam',
    'interview',
    'qualification_review',
    'admit_ticket',
    'registration_start',
    'preliminary_review',
    'review_result',
    'interview_confirm',
    'medical_exam',
    'score_review',
  ];
  if (SUGGEST_KINDS.includes(kind) && daysUntil <= 14) return 'suggest';
  if (kind === 'registration_start' && daysUntil <= 3) return 'suggest';
  return 'info';
}

/**
 * 由事件变更推导通知分级。
 * - 截止日期提前/资格相关条件变化 → must_handle；
 * - 笔试/面试时间变化 → suggest_handle；
 * - 仅新增待定事项或成绩日期 → info。
 */
export function severityOfChange(
  kind: TimelineEventKind,
  oldDateIso: string | null,
  newDateIso: string | null,
): NotificationSeverity {
  const MUST_KINDS: TimelineEventKind[] = [
    'registration_end',
    'payment',
    'amendment_deadline',
    'admit_ticket_end',
    'qualification_review',
  ];
  if (MUST_KINDS.includes(kind)) {
    return oldDateIso !== newDateIso ? 'must_handle' : 'info';
  }
  const SUGGEST_KINDS: TimelineEventKind[] = [
    'written_exam',
    'interview',
    'admit_ticket',
    'registration_start',
    'preliminary_review',
    'review_result',
    'interview_confirm',
    'medical_exam',
    'score_review',
  ];
  if (SUGGEST_KINDS.includes(kind)) {
    return 'suggest_handle';
  }
  return 'info';
}

/** 计算两个 ISO 日期相差的天数（today - target）；target 为 null 时返回 null */
export function daysUntil(targetIso: string | null, nowIso: string): number | null {
  if (!targetIso) return null;
  const target = new Date(`${targetIso}T00:00:00`).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(target) || Number.isNaN(now)) return null;
  return Math.ceil((target - now) / (24 * 60 * 60 * 1000));
}

/** 判断事件是否已过去 */
export function isPast(dateIso: string | null, nowIso: string): boolean {
  if (!dateIso) return false;
  const d = daysUntil(dateIso, nowIso);
  return d !== null && d < 0;
}

// ==================== M7 默认站内提醒阶段 ====================

/**
 * 每种节点的默认提醒阶段（PRD v7.1 §5.8）。
 * - "d-N" 表示提前 N 天；
 * - "d-0" 表示当天；
 * - "published" 表示官方发布后。
 * 同一用户+岗位+节点+提醒阶段只产生一次通知（幂等键）。
 */
export const REMINDER_STAGES: Partial<Record<TimelineEventKind, string[]>> = {
  registration_start: ['d-0'],
  registration_end: ['d-7', 'd-3', 'd-1'],
  payment: ['d-3', 'd-1'],
  admit_ticket: ['d-0'],
  admit_ticket_end: ['d-1'],
  written_exam: ['d-7', 'd-1'],
  score: ['published'],
  qualification_review: ['d-3', 'd-1'],
  interview: ['d-7', 'd-1'],
};

/**
 * 根据当前时间计算哪些提醒阶段应当触发。
 * 返回的 stage 列表可用于查重后创建幂等通知。
 */
export function dueReminderStages(
  kind: TimelineEventKind,
  dateIso: string | null,
  nowIso: string,
): string[] {
  if (!dateIso) return [];
  const stages = REMINDER_STAGES[kind];
  if (!stages) return [];
  const d = daysUntil(dateIso, nowIso);
  if (d === null) return [];

  const result: string[] = [];
  for (const stage of stages) {
    if (stage === 'published') {
      // 成绩已发布（事件存在即视为已发布）：d <= 0 时触发
      if (d <= 0) result.push(stage);
      continue;
    }
    if (stage === 'd-0') {
      if (d <= 0) result.push(stage);
      continue;
    }
    // d-N：提前 N 天；d <= N 时触发（已过去也触发一次，补发不重复）
    const n = parseInt(stage.slice(2), 10);
    if (!Number.isNaN(n) && d <= n) result.push(stage);
  }
  return result;
}

/**
 * 构造提醒阶段的稳定幂等键。
 * 格式：`${eventKey}#${stage}` —— 同一用户+eventKey+stage 在 DB 唯一约束下幂等。
 */
export function reminderDedupKey(
  eventKey: string,
  stage: string,
): string {
  return `${eventKey}#${stage}`;
}

