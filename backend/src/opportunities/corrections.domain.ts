/**
 * 机会纠错处理状态机（v7.0 P0-F / 模块 8；D08 扩展 need_supplement）。
 *
 * 用户只能提交纠错；处理闭环由员工在运营后台完成：
 *
 *   submitted（已提交）
 *      ├─ reviewing（核对中）
 *      │     ├─ resolved（已修正）
 *      │     ├─ rejected（不采纳）
 *      │     └─ need_supplement（需补充 ← D08：须附说明，告知用户需补什么）
 *      ├─ resolved（已修正）   ← 允许不经过 reviewing 直接闭环
 *      ├─ rejected（不采纳）
 *      └─ need_supplement（需补充）
 *   need_supplement ─ reviewing / resolved / rejected（补充材料到位后继续推进）
 *
 * 不变量：
 * - resolved/rejected 为终态，任何人不能再改（纠错不物理删除，留痕可审计）；
 * - rejected / need_supplement 必须附处理说明，向提交人解释原因或需补充的内容；
 * - resolved 必须真实：数据类问题需登记已发布的修正版本，非数据类问题需写明实际处理结果（R05）；
 * - 同一终态的重复提交按幂等处理（返回当前记录、不重复通知）；
 * - 每次状态推进都记录处理人与处理时间。
 */

export const CORRECTION_STATUSES = [
  'submitted',
  'reviewing',
  'need_supplement',
  'resolved',
  'rejected',
] as const;

export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly CorrectionStatus[] = [
  'resolved',
  'rejected',
];

/** 员工可设置的状态（submitted 只能由用户提交产生） */
export const REVIEW_ACTIONS: readonly CorrectionStatus[] = [
  'reviewing',
  'need_supplement',
  'resolved',
  'rejected',
];

const ALLOWED_TRANSITIONS: Record<CorrectionStatus, readonly CorrectionStatus[]> = {
  submitted: ['reviewing', 'need_supplement', 'resolved', 'rejected'],
  reviewing: ['need_supplement', 'resolved', 'rejected'],
  need_supplement: ['reviewing', 'resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export function isCorrectionStatus(value: string): value is CorrectionStatus {
  return (CORRECTION_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransition(from: string, to: CorrectionStatus): boolean {
  if (!isCorrectionStatus(from)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * 校验一次员工处理动作。
 * @param input.from 当前状态
 * @param input.to 目标状态
 * @param input.reviewNote 本次附带的处理说明
 * @param input.existingNote 记录上已有的处理说明（如从 need_supplement 推进时可沿用）
 * @returns null 表示合法；否则返回面向用户的错误信息
 */
export function validateReview(input: {
  from: string;
  to: unknown;
  reviewNote?: unknown;
  existingNote?: string | null;
}): { ok: false; message: string } | { ok: true; status: CorrectionStatus; note: string | null } {
  if (typeof input.to !== 'string' || !isCorrectionStatus(input.to)) {
    return { ok: false, message: '处理状态无效' };
  }
  const to = input.to;
  if (to === 'submitted') {
    return { ok: false, message: '不能将纠错退回到已提交状态' };
  }
  if (!canTransition(input.from, to)) {
    return isTerminalStatus(input.from)
      ? { ok: false, message: '该纠错已处理完成，终态不能再次修改' }
      : { ok: false, message: '当前纠错状态不允许该操作' };
  }
  const note =
    typeof input.reviewNote === 'string' && input.reviewNote.trim().length > 0
      ? input.reviewNote.trim()
      : null;
  if (note && note.length > 500) {
    return { ok: false, message: '处理说明不能超过 500 字' };
  }
  if (to === 'rejected' || to === 'need_supplement') {
    // 需补充/不采纳必须有说明可查：本次没写时沿用记录上已有的说明
    const existing =
      typeof input.existingNote === 'string' && input.existingNote.trim().length > 0
        ? input.existingNote.trim()
        : null;
    if (!note && !existing) {
      return to === 'rejected'
        ? { ok: false, message: '标记「不采纳」必须填写处理说明，向提交人解释原因' }
        : { ok: false, message: '标记「需补充」必须填写处理说明，告知提交人需要补充什么' };
    }
  }
  return { ok: true, status: to, note };
}

/**
 * 用户在纠错弹窗中选择的问题位置（与前端 CorrectionModal FIELD_OPTIONS 对应）。
 * D08（PRD 11.9）：补齐匹配结论、失效链接、重复收录；遗漏公告走补录通道
 * （AnnouncementSubmission，无岗位绑定），不占用单元纠错的 fieldPath。
 */
export const FIELD_PATH_LABELS: Record<string, string> = {
  major: '专业目录 / 资格条件',
  timeline: '报名时间 / 考试安排',
  headcount: '招聘人数 / 岗位信息',
  evidence: '官方来源或原文摘录',
  matching: '匹配结论（符合/不符合判断）',
  dead_link: '官方链接失效',
  duplicate: '重复收录',
  other: '其他问题',
};

/**
 * 必须通过“发布修正版本”才能真实结案的数据类问题（R05）。
 * 其余位置是体验/结论类反馈，不产生新公告版本，结案必须写清实际处理结果。
 */
export const VERSION_CORRECTABLE_FIELDS: readonly string[] = [
  'major',
  'timeline',
  'headcount',
  'evidence',
];

export function isVersionCorrectableField(fieldPath: string): boolean {
  return VERSION_CORRECTABLE_FIELDS.includes(fieldPath);
}

/** 公告版本在纠错结案校验时所需的只读信息 */
export interface CorrectionVersionRef {
  id: string;
  versionNumber: number;
  /** 已被后续版本取代的版本不能作为修正落点 */
  superseded: boolean;
}

export type ResolutionCheck =
  | { ok: true; resolvedVersionId: string | null }
  | {
      ok: false;
      kind:
        | 'version_not_published'
        | 'invalid_version'
        | 'version_not_allowed'
        | 'note_required';
      message: string;
    };

/**
 * 校验“已修正”结案是否真实（R05）。
 * - 数据类问题：必须登记该公告当前有效、且晚于提交版本的已发布修正版本，
 *   否则不能以“已修正”结案（修正还没发布时就应保持处理中）；
 * - 非数据类问题：不允许登记修正版本，必须写清实际处理结果。
 */
export function validateResolution(input: {
  fieldPath: string;
  submittedVersionId: string;
  reviewNote: string | null;
  resolvedVersionId: string | null;
  versions: readonly CorrectionVersionRef[];
}): ResolutionCheck {
  const { fieldPath, submittedVersionId, reviewNote, resolvedVersionId, versions } =
    input;
  if (!isVersionCorrectableField(fieldPath)) {
    if (resolvedVersionId) {
      return {
        ok: false,
        kind: 'version_not_allowed',
        message:
          '这类问题不通过公告版本修正，不能登记修正版本；请在处理说明中写清实际处理结果',
      };
    }
    if (!reviewNote || reviewNote.trim().length < 5) {
      return {
        ok: false,
        kind: 'note_required',
        message: '非数据类问题结案必须填写至少 5 个字的处理说明，写清实际处理结果',
      };
    }
    return { ok: true, resolvedVersionId: null };
  }

  if (!resolvedVersionId) {
    return {
      ok: false,
      kind: 'version_not_published',
      message:
        '该问题属于公告数据，必须登记已发布的修正版本后才能结案；修正版本尚未发布时请保持处理中',
    };
  }
  const target = versions.find((version) => version.id === resolvedVersionId);
  if (!target) {
    return {
      ok: false,
      kind: 'invalid_version',
      message: '修正版本不属于该公告的版本链，请核对后填写',
    };
  }
  if (target.superseded) {
    return {
      ok: false,
      kind: 'invalid_version',
      message: '登记的修正版本已被取代，请登记当前有效的版本',
    };
  }
  const submitted = versions.find((version) => version.id === submittedVersionId);
  if (submitted && target.versionNumber <= submitted.versionNumber) {
    return {
      ok: false,
      kind: 'invalid_version',
      message: '登记的修正版本需晚于纠错提交时的版本，才能证明更正已发布',
    };
  }
  return { ok: true, resolvedVersionId: target.id };
}

export function fieldPathLabel(fieldPath: string): string {
  return FIELD_PATH_LABELS[fieldPath] ?? fieldPath;
}

/** 纠错记录对外 DTO（不含他人联系方式；contact 仅员工队列按权限使用） */
export interface CorrectionDTO {
  id: string;
  unitId: string;
  /** 单元已随旧版本移除时为 null，记录仍保留可审计 */
  unitName: string | null;
  announcementId: string;
  announcementTitle: string | null;
  versionId: string;
  fieldPath: string;
  fieldLabel: string;
  content: string;
  contact: string | null;
  status: string;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  /** D08：采纳修正时登记的已发布版本 id（处理人填写，可空；供用户回详情核对） */
  resolvedVersionId: string | null;
  createdAt: string;
}

/** 员工队列项：附带提交人账号信息（仅 STAFF_ROLES 可见） */
export interface StaffCorrectionDTO extends CorrectionDTO {
  submitter: {
    id: string;
    email: string;
    name: string | null;
  };
}
