/**
 * v6.1 信息架构展示层：纯展示文案/格式化辅助。
 *
 * 这里不做资格判断（规则在 lib/matching/domain.ts），只把领域对象格式化为
 * 页面可直接渲染的短文案；所有函数无副作用、确定性，便于单测。
 */
import type {
  EmploymentNatureCode,
  RegionRef,
  StageCode,
  SubjectCode,
} from "@/lib/announcements/types";
import type { MaterialStatus } from "@/lib/announcements/types";
import type { FollowStatus, StudyTargetRole } from "@/lib/opportunities/types";

/** 学段（v6.1 StageCode 用户可见文案） */
export const STAGE_LABELS: Record<string, string> = {
  primary: "小学",
  middle: "初中",
  high: "高中",
};

export function stageLabel(stage: StageCode): string {
  return STAGE_LABELS[stage] ?? "其他学段";
}

/** 学科（SubjectCode 用户可见文案） */
export const SUBJECT_LABELS: Record<string, string> = {
  chinese: "语文",
  mathematics: "数学",
  english: "英语",
  physics: "物理",
  chemistry: "化学",
  biology: "生物",
  history: "历史",
  geography: "地理",
  politics: "政治",
  music: "音乐",
  pe: "体育",
  art: "美术",
  it: "信息技术",
};

export function subjectLabel(subject: SubjectCode): string {
  return SUBJECT_LABELS[subject] ?? "其他学科";
}

/**
 * 学段与学科组合的用户可见文案，统一格式「初中 · 语文」。
 * 页面不得直接拼接 stage + subject 枚举值（会产生 "middlechinese" 等内部串）。
 */
export function stageSubjectLabel(
  stage: StageCode,
  subject: SubjectCode,
): string {
  return `${stageLabel(stage)} · ${subjectLabel(subject)}`;
}

/** 报名材料状态用户可见文案 */
export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  not_started: "未开始",
  in_progress: "准备中",
  done: "已完成",
  not_applicable: "不适用",
};

export function materialStatusLabel(status: MaterialStatus): string {
  return MATERIAL_STATUS_LABELS[status] ?? status;
}

/** 关注/跟进状态用户可见文案（与 FOLLOW_STATUS_LABELS 保持一致，集中维护） */
export const FOLLOW_STATUS_UI_LABELS: Record<FollowStatus, string> = {
  considering: "考虑中",
  preparing: "准备报名",
  registered: "已报名",
  abandoned: "已放弃",
  closed: "已结束",
};

export const STUDY_TARGET_ROLE_UI_LABELS: Record<StudyTargetRole, string> = {
  primary: "重点准备",
  backup: "备选机会",
};

/** 通用任务/进度状态的用户可见文案 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待确认",
  not_started: "未开始",
  in_progress: "准备中",
  completed: "已完成",
  partial: "部分完成",
  abandoned: "已放弃",
};

/** 用工性质短标签：编码稳定，文案比 officialName 更短，适合卡片一行展示 */
export const NATURE_SHORT_LABELS: Record<EmploymentNatureCode, string> = {
  public_institution_staff: "事业编",
  record_filing: "备案制",
  post_quota: "员额制",
  headcount_control: "控制数",
  other: "其他官方用工",
};

export function natureShortLabel(code: EmploymentNatureCode): string {
  return NATURE_SHORT_LABELS[code] ?? NATURE_SHORT_LABELS.other;
}

/** 地区短标签：优先“城市·区”，其次城市，其次省 */
export function regionLabel(region: RegionRef): string {
  if (region.district && region.city) return `${region.city}·${region.district}`;
  return region.district ?? region.city ?? region.province;
}

/**
 * 卡片第一层的完整省市区表达（v7.1 M4：省、市、区一眼可见）。
 * 信息未公布的部分省略，不猜测补齐。
 */
export function regionFullLabel(region: RegionRef): string {
  const parts = [region.province, region.city, region.district].filter(Boolean);
  return parts.join(" ");
}

/** 条件维度文案（“补充户籍信息后判断”分组标题用） */
export const DIMENSION_LABELS: Record<string, string> = {
  region: "地区意向",
  education: "学历",
  degree: "学位",
  major: "专业",
  graduate_status: "毕业与就业状态",
  teacher_cert: "教师资格",
  age: "年龄",
  hukou: "户籍",
  social_security: "社保",
  work_experience: "工作经历",
  other: "公告特有条件",
};

export function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension] ?? DIMENSION_LABELS.other;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateMidnight(iso: string): Date {
  // 日期字段（YYYY-MM-DD）与完整 ISO 都按本地零点比较，避免时区误差
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 剩余自然日；返回负数表示已过去 N 天 */
export function daysUntil(dateIso: string, nowIso: string): number {
  const target = toDateMidnight(dateIso).getTime();
  const now = toDateMidnight(nowIso).getTime();
  return Math.round((target - now) / MS_PER_DAY);
}

/** “M月D日 周X” */
export function dateWithWeekday(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[date.getDay()]}`;
}

export interface DeadlineText {
  /** 完整一句话，如“10月20日截止，还剩 16 天”；预告批次为“报名时间待官方通知” */
  text: string;
  closed: boolean;
  /** 官方未公布报名时间时为 null（绝不臆造日期） */
  daysLeft: number | null;
  /** 官方尚未公布具体报名时间（预告批次） */
  unconfirmed: boolean;
}

/** 报名截止文案；未公布/未开始/进行中/已截止四态都有文字，不只靠颜色 */
export function deadlineText(
  registrationEnd: string | undefined,
  nowIso: string,
): DeadlineText {
  // 官方尚未公布具体报名日期：不得用“预计”“参考往年”等措辞冒充确定时间
  if (!registrationEnd) {
    return {
      text: "报名时间待官方通知",
      closed: false,
      daysLeft: null,
      unconfirmed: true,
    };
  }
  const daysLeft = daysUntil(registrationEnd, nowIso);
  const dateText = dateWithWeekday(registrationEnd);
  if (daysLeft < 0) {
    return { text: `${dateText} 已截止`, closed: true, daysLeft, unconfirmed: false };
  }
  if (daysLeft === 0) {
    return { text: `${dateText} 今天截止`, closed: false, daysLeft, unconfirmed: false };
  }
  return {
    text: `${dateText} 截止，还剩 ${daysLeft} 天`,
    closed: false,
    daysLeft,
    unconfirmed: false,
  };
}
