/**
 * v6.1 访客初步机会结果（纯函数，确定性规则）。
 *
 * 输入：访客五组基础画像草稿 + 已收录公告（演示环境为 v6.1 seed）。
 * 输出三类结果：
 * - ready：画像完整且意向学科已开放，复用 lib/ia/opportunities-view 的视图模型，
 *   优先展示“初步符合”，其余机会按缺失条件分组，并给出“为什么要补这条信息”；
 * - subject_not_open：意向学科当前尚未开放，明确分流，绝不生成虚假匹配；
 * - incomplete：画像未完成五组采集（页面应回到 /onboarding）。
 *
 * 资格判断完全复用 lib/matching/domain.ts 与机会页视图模型，本文件不重复实现规则；
 * 首次结果只做机会匹配，不生成 7 天备考计划。
 *
 * 不变量：访客草稿不含年龄/户籍/社保/工作经历，这些维度只能是 UNKNOWN，
 * 不会被判定为“明确不符合”（由 matching/domain.ts 保证，测试回归）。
 */
import type { RecruitmentAnnouncement } from "@/lib/announcements/types";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import {
  buildOpportunitiesView,
  type OpportunitiesView,
  type OpportunityRow,
} from "@/lib/ia/opportunities-view";
import {
  V61_NOW,
  V61_SEED_ANNOUNCEMENTS,
} from "@/lib/seed/v61-opportunities";
import {
  buildProfileLimitations,
  draftToProfile,
  isSubjectOpen,
  subjectLabel,
  type EmploymentNaturePreference,
  type GuestProfileDraft,
  type ProfileLimitation,
} from "./guestSession";

/** 访客结果页只演示判断方式，不把虚构机会包装成可保存的真实机会。 */
export const GUEST_PREVIEW_ACTION_HREF = "#demo-opportunity";

/** 按需补问：一个缺失维度对应一组机会与“为什么要补”的说明 */
export interface GuestFollowUp {
  dimension: string;
  dimensionText: string;
  /** 影响多少个机会（补一条信息能解锁的判断数） */
  affectsCount: number;
  /** 为什么需要补充（用户可见），明确“不补充 ≠ 不符合” */
  reason: string;
}

/** Preview 全页唯一的主要行动：查看一个示例判断，不触发登录或保存。 */
export interface GuestPrimaryAction {
  label: string;
  href: string;
}

export interface GuestPreviewReady {
  kind: "ready";
  profile: UserRecruitmentProfile;
  view: OpportunitiesView;
  /** 按需补问说明（与 view.needInfoGroups 对应，额外给出补问原因） */
  followUps: GuestFollowUp[];
  /**
   * 最低必要信息缺失导致的结果限制（用户在采集时选择「暂不确定/暂不提供」）。
   * 页面必须原样展示：让用户知道结论收窄到了什么程度，且这不是「不符合」。
   */
  limitations: ProfileLimitation[];
  /** 整页唯一高强调行动；无可解释示例时为 null（页面转空态） */
  primaryAction: GuestPrimaryAction | null;
  /** 用工形式偏好（v7.1 M3）：undefined/undecided = 未选择，不筛选 */
  naturePreference: EmploymentNaturePreference | undefined;
  /**
   * 「只看事业编」时被偏好筛除的机会（非事业编）。
   * 只是偏好筛选：这些岗位绝不是资格不符合，页面必须放在“暂不推荐”
   * 并说明可随时切换，不得计入「明确不符合」或从页面无声消失。
   */
  natureOutOfPreference: OpportunityRow[];
}

export interface GuestPreviewNotOpen {
  kind: "subject_not_open";
  /** 用户意向学科的用户可见名称 */
  subjectLabel: string;
}

export interface GuestPreviewIncomplete {
  kind: "incomplete";
}

export type GuestPreview =
  | GuestPreviewReady
  | GuestPreviewNotOpen
  | GuestPreviewIncomplete;

/**
 * 各缺失维度的补问原因。
 * 条件画像（年龄/户籍/社保/经历）本就不采集；基础五组在用户选择
 * 「暂不确定/暂不提供」时同样会缺失——两种缺事实都只能 UNKNOWN，绝不判不符合。
 */
const FOLLOW_UP_REASONS: Record<string, string> = {
  region:
    "你还没有选择能接受的地区：补充至少一个地区后，这些岗位才能按地区判断；没选地区不会被当作不符合。",
  education:
    "你暂未提供最高学历，这些岗位有明确学历门槛，补充后才能判断；未提供不判不符合。",
  degree:
    "你暂未提供学位信息，这些岗位有学位要求，补充后才能判断；未提供不判不符合。",
  major:
    "你暂未提供毕业证专业全称，这些岗位限报专业，补充名称后才能逐条比对；未提供不判专业不符。",
  graduate_status:
    "你暂未提供毕业时间与当前状态，这些岗位按应届/社会人员区分，补充后才能判断。",
  teacher_cert:
    "你暂未提供教师资格情况，这些岗位要求教师资格证或合格证明，补充后才能判断；未提供不当作没有资格。",
  hukou:
    "这些机会的公告写明了户籍或生源地要求，补充户籍所在地区后才能判断；没有填写不会被直接判定为不符合。",
  age: "这些机会有明确的年龄上限，需要出生日期后按公告参考日计算周岁，补充后才能判断。",
  social_security:
    "这些机会对社保缴纳记录有要求，需要你按实际记录填写已缴月数后判断；未填写不判不符合。",
  work_experience:
    "这些机会要求相关岗位工作经历，补充经历月数后才能判断；未填写不判不符合。",
  other:
    "这些机会含公告特有的报考条件，需要你逐项补充，或直接向招聘单位确认后再报名。",
};

function followUpReason(dimension: string): string {
  return (
    FOLLOW_UP_REASONS[dimension] ??
    "这些机会还缺少部分条件信息，补充后才能判断；未填写不会被直接判定为不符合。"
  );
}

function buildFollowUps(view: OpportunitiesView): GuestFollowUp[] {
  return view.needInfoGroups.map((group) => ({
    dimension: group.dimension,
    dimensionText: group.dimensionText,
    affectsCount: group.count,
    reason: followUpReason(group.dimension),
  }));
}

/**
 * 唯一主行动：跳到排序第一的示例，帮助用户理解判断方式。
 * seed 机会是虚构数据，不能引导关注、报名或以保存为由要求登录。
 */
function buildPrimaryAction(view: OpportunitiesView): GuestPrimaryAction | null {
  const priority = view.priority;
  if (!priority) return null;
  return { label: "看看示例怎么判断", href: GUEST_PREVIEW_ACTION_HREF };
}

/**
 * v7.1 M3 用工偏好与资格分层：偏好筛选只发生在访客结果视图这一层，
 * matching/domain.ts 的资格判定完全不受影响——被筛除的岗位从这里原样
 * 返回给页面放进“暂不推荐”，绝不会被改判为 not_eligible。
 * 只在「只看事业编」时筛选；official_open/undecided/未选择都不筛选。
 */
function applyNaturePreference(
  view: OpportunitiesView,
  pref: EmploymentNaturePreference | undefined,
): { view: OpportunitiesView; filtered: OpportunityRow[] } {
  if (pref !== "public_only") return { view, filtered: [] };
  const isPublic = (row: OpportunityRow) =>
    row.natureCode === "public_institution_staff";
  const filtered: OpportunityRow[] = [];

  let priority = view.priority;
  if (priority && !isPublic(priority)) {
    filtered.push(priority);
    priority = null;
  }
  const preliminary = view.preliminary.filter((row) => {
    if (isPublic(row)) return true;
    filtered.push(row);
    return false;
  });
  const needInfoGroups = view.needInfoGroups
    .map((group) => {
      const rows = group.rows.filter((row) => {
        if (isPublic(row)) return true;
        filtered.push(row);
        return false;
      });
      return { ...group, rows, count: rows.length };
    })
    .filter((group) => group.rows.length > 0);
  const manualReview = view.manualReview.filter((row) => {
    if (isPublic(row)) return true;
    filtered.push(row);
    return false;
  });
  // 访客画像地区必填，needInfo 分组不会混入地区 UNKNOWN 的非有效候选，
  // 因此有效数 = 剩余 preliminary + needInfo + manualReview。
  const validCount =
    preliminary.length +
    manualReview.length +
    needInfoGroups.reduce((sum, group) => sum + group.rows.length, 0);
  if (priority === null && filtered.length > 0) {
    // 原优先机会被筛掉时，按原排序从剩余有效机会中取第一个（页面避免误入空态）
    priority =
      preliminary[0] ?? needInfoGroups[0]?.rows[0] ?? manualReview[0] ?? null;
  }
  return {
    view: {
      ...view,
      priority,
      preliminary,
      needInfoGroups,
      manualReview,
      validCount,
    },
    filtered,
  };
}

/**
 * 生成访客初步机会结果。纯函数：同一草稿 + 同一批公告 + 同一参考时间必得同一结果
 * （测试依赖该性质，页面传入固定 V61_NOW，不使用 new Date()）。
 */
export function buildGuestPreview(
  draft: GuestProfileDraft,
  announcements: RecruitmentAnnouncement[] = V61_SEED_ANNOUNCEMENTS,
  nowIso: string = V61_NOW,
): GuestPreview {
  // 非语文：明确“尚未开放”分流，不跑匹配、不产出任何机会
  if (draft.intendedSubject !== undefined && !isSubjectOpen(draft)) {
    return { kind: "subject_not_open", subjectLabel: subjectLabel(draft.intendedSubject) };
  }

  const profile = draftToProfile(draft);
  if (!profile) return { kind: "incomplete" };

  const baseView = buildOpportunitiesView(announcements, profile, nowIso);
  const { view, filtered } = applyNaturePreference(
    baseView,
    draft.employmentNaturePreference,
  );

  return {
    kind: "ready",
    profile,
    view,
    followUps: buildFollowUps(view),
    limitations: buildProfileLimitations(draft),
    primaryAction: buildPrimaryAction(view),
    naturePreference: draft.employmentNaturePreference,
    natureOutOfPreference: filtered,
  };
}
