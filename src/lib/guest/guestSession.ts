/**
 * v7.1 首次体验（访客）画像会话（PRD 7.3 / v7.1 M2 两屏基础画像）。
 *
 * 未登录用户通过两屏基础画像即可查看初步机会结果；
 * 草稿与进度保存在本机浏览器 localStorage（kb_guest_profile_v61），7 天过期。
 *
 * v7.1 M2 两屏基础画像：
 * 1. 地区意向 — 可接受地区（只考虑 / 优先考虑 / 也可以考虑）
 * 2. 基础资格 — 最高学历、专业全称、毕业时间、教师资格状态（+学段/学科/预计时间）
 *
 * 从首次流程移出改为按机会补问：就业状态、户籍/生源地、社保和劳动关系、
 * 工作经历、普通话等级、年龄、用工形式偏好、地区特有条件。
 * 取消独立"补充信息说明"步骤；结果页直接说明"补充哪一项会影响多少机会"。
 *
 * 年龄、户籍、社保、工作经历不在这里一次收齐：它们属于条件画像，
 * 只在具体机会需要时按需补问；草稿不包含这些字段，匹配时只能得到 UNKNOWN，
 * 永远不会被自动判定为"不符合"（规则见 lib/matching/domain.ts）。
 *
 * 注意：这不是真实认证或跨设备保存。接入真实后端时，登录成功后再把
 * 完整草稿提交服务端持久化；本轮（模块 4）不做登录持久化。
 */
import {
  type CredentialLevel,
  type DegreeCode,
  type EmploymentNatureCode,
  type StageCode,
  type SubjectCode,
} from "@/lib/announcements/types";
import type {
  EmploymentStatus,
  RegionPreference,
  RegionPreferenceLevel,
  TeacherCertInfo,
  TeacherCertStatus,
  UserRecruitmentProfile,
} from "@/lib/profile/types";
import { STORAGE_KEYS } from "@/lib/mock-data";
import { loadFromStorage, saveToStorageStrict, removeFromStorage } from "@/lib/storage";

/**
 * v7.1 M2 两屏基础画像采集：
 * 1. 地区意向 — 可接受地区（只考虑 / 优先考虑 / 也可以考虑）
 * 2. 基础资格 — 最高学历、专业全称、毕业时间、教师资格状态（+学段/学科/预计时间）
 *
 * 草稿数据模型（GuestProfileDraft）不变，仅重组字段分组与步骤数。
 * 旧 3 步/5 步草稿的 session.step 值会在读取时自动归入新 2 步范围（见 migrateSessionStep）。
 */
export const TOTAL_PROFILE_STEPS = 2;

/** 当前唯一开放学科；其他学科在访客流程中明确分流，不生成匹配结果 */
export const OPEN_SUBJECT = "chinese" as const;

export interface GuestProfileDraft {
  /** 1. 可接受就业地区（至少 1 条才能进入下一组） */
  regions: RegionPreference[];
  /** 2. 最高学历 */
  educationLevel?: CredentialLevel;
  /** 2. 最高学位（无学位显式填 none） */
  degree?: DegreeCode;
  /** 3. 毕业证上的专业全称 */
  majorFullName?: string;
  /** 4. 毕业（或预计毕业）时间，ISO 日期（YYYY-MM-DD） */
  graduationDate?: string;
  /** 4. 当前就业状态 */
  employmentStatus?: EmploymentStatus;
  /** 5. 教师资格情况 */
  teacherCert?: TeacherCertInfo;
  /**
   * 对事业编及其他官方用工形式的接受程度（白名单）。
   * v7.1 M2：已移出首次流程，空数组=未提供（匹配引擎不据此判 PASS/FAIL）；
   * 旧草稿保留原值，按机会补问后再回填。
   */
  acceptedEmploymentNatures: EmploymentNatureCode[];
  /** 5. 意向报考学科；语文以外的学科记为“尚未开放”，不进入匹配 */
  intendedSubject?: SubjectCode;
  /** 非语文用户已在本机留下开注意向（仅本地标记，不发送任何通知） */
  intentionLeft?: boolean;
  /**
   * 显式选择「暂不确定 / 暂不提供」的步骤号（1..5，模块 4）。
   * 被跳过的步骤视为完成、允许继续，但相关字段保持空缺：
   * 匹配引擎只能判 UNKNOWN（补充信息后判断），绝不能判为「明确不符合」。
   * 用户一旦补填该步内容，步骤号会被 pruneSkippedSteps 自动移除。
   */
  skippedSteps?: number[];
}

export interface GuestProfileSession {
  draft: GuestProfileDraft;
  /** 已完成到第几组：0 未开始；1..5 为已完成组数；5 表示五组答完可看结果 */
  step: number;
  createdAt: string;
  updatedAt: string;
  /** 过期时间（ISO）：超过后视为无效，重新开始 */
  expiresAt: string;
}

/** 访客数据保留 7 天 */
const GUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function emptyDraft(): GuestProfileDraft {
  return {
    regions: [],
    // v7.1 M2：用工形式偏好已移出首次流程，空数组=未提供；
    // 不再默认填全集（用户从未确认的偏好不得被静默记为接受）
    acceptedEmploymentNatures: [],
  };
}

function isExpired(session: GuestProfileSession): boolean {
  return Date.now() > Date.parse(session.expiresAt);
}

// ==================== 采集选项（页面直接复用，避免文案散落） ====================

export const REGION_LEVEL_OPTIONS: {
  value: RegionPreferenceLevel;
  label: string;
  hint: string;
}[] = [
  { value: "required", label: "只考虑", hint: "只推荐这个地区的岗位" },
  { value: "preferred", label: "优先考虑", hint: "这个地区的岗位优先展示" },
  { value: "consider", label: "也可以考虑", hint: "有合适岗位时可以推荐" },
];

export const PROVINCE_OPTIONS: { code: string; name: string }[] = [
  { code: "110000", name: "北京市" },
  { code: "120000", name: "天津市" },
  { code: "130000", name: "河北省" },
  { code: "140000", name: "山西省" },
  { code: "150000", name: "内蒙古自治区" },
  { code: "210000", name: "辽宁省" },
  { code: "220000", name: "吉林省" },
  { code: "230000", name: "黑龙江省" },
  { code: "310000", name: "上海市" },
  { code: "320000", name: "江苏省" },
  { code: "330000", name: "浙江省" },
  { code: "340000", name: "安徽省" },
  { code: "350000", name: "福建省" },
  { code: "360000", name: "江西省" },
  { code: "370000", name: "山东省" },
  { code: "410000", name: "河南省" },
  { code: "420000", name: "湖北省" },
  { code: "430000", name: "湖南省" },
  { code: "440000", name: "广东省" },
  { code: "450000", name: "广西壮族自治区" },
  { code: "460000", name: "海南省" },
  { code: "500000", name: "重庆市" },
  { code: "510000", name: "四川省" },
  { code: "520000", name: "贵州省" },
  { code: "530000", name: "云南省" },
  { code: "540000", name: "西藏自治区" },
  { code: "610000", name: "陕西省" },
  { code: "620000", name: "甘肃省" },
  { code: "630000", name: "青海省" },
  { code: "640000", name: "宁夏回族自治区" },
  { code: "650000", name: "新疆维吾尔自治区" },
];

/**
 * 已收录城市（统计用区划码前 4 位）。
 * 演示公告集中在浙苏皖，因此这三省给到地级市；其他省份选“全省均可”即可，
 * 省级代码按前缀匹配，不影响省内机会筛选。
 */
export const CITY_OPTIONS: Record<string, { code: string; name: string }[]> = {
  "330000": [
    { code: "330100", name: "杭州市" },
    { code: "330200", name: "宁波市" },
    { code: "330300", name: "温州市" },
    { code: "330400", name: "嘉兴市" },
    { code: "330500", name: "湖州市" },
    { code: "330600", name: "绍兴市" },
    { code: "330700", name: "金华市" },
    { code: "330800", name: "衢州市" },
    { code: "330900", name: "舟山市" },
    { code: "331000", name: "台州市" },
    { code: "331100", name: "丽水市" },
  ],
  "320000": [
    { code: "320100", name: "南京市" },
    { code: "320200", name: "无锡市" },
    { code: "320300", name: "徐州市" },
    { code: "320400", name: "常州市" },
    { code: "320500", name: "苏州市" },
    { code: "320600", name: "南通市" },
    { code: "320700", name: "连云港市" },
    { code: "320800", name: "淮安市" },
    { code: "320900", name: "盐城市" },
    { code: "321000", name: "扬州市" },
    { code: "321100", name: "镇江市" },
    { code: "321200", name: "泰州市" },
    { code: "321300", name: "宿迁市" },
  ],
  "340000": [
    { code: "340100", name: "合肥市" },
    { code: "340200", name: "芜湖市" },
    { code: "340300", name: "蚌埠市" },
    { code: "340400", name: "淮南市" },
    { code: "340500", name: "马鞍山市" },
    { code: "340600", name: "淮北市" },
    { code: "340700", name: "铜陵市" },
    { code: "340800", name: "安庆市" },
    { code: "341000", name: "黄山市" },
    { code: "341100", name: "滁州市" },
    { code: "341200", name: "阜阳市" },
    { code: "341300", name: "宿州市" },
    { code: "341500", name: "六安市" },
    { code: "341600", name: "亳州市" },
    { code: "341700", name: "池州市" },
    { code: "341800", name: "宣城市" },
  ],
};

export const CREDENTIAL_LEVEL_OPTIONS: { value: CredentialLevel; label: string }[] = [
  { value: "secondary", label: "中专 / 高中" },
  { value: "college", label: "大专" },
  { value: "bachelor", label: "本科" },
  { value: "master", label: "硕士研究生" },
  { value: "doctorate", label: "博士研究生" },
];

export const DEGREE_OPTIONS: { value: DegreeCode; label: string }[] = [
  { value: "none", label: "没有学位" },
  { value: "bachelor", label: "学士学位" },
  { value: "master", label: "硕士学位" },
  { value: "doctorate", label: "博士学位" },
];

export const EMPLOYMENT_STATUS_OPTIONS: {
  value: EmploymentStatus;
  label: string;
  hint?: string;
}[] = [
  { value: "student", label: "在读，还没毕业" },
  { value: "fresh_unemployed", label: "已毕业，暂时没落实工作" },
  { value: "employed_fulltime", label: "已落实全职工作" },
  { value: "employed_parttime", label: "灵活就业 / 兼职" },
  { value: "other", label: "其他情况" },
];

export const TEACHER_CERT_STATUS_OPTIONS: {
  value: TeacherCertStatus;
  label: string;
  hint: string;
}[] = [
  { value: "obtained", label: "已经取得教师资格证", hint: "" },
  { value: "in_progress", label: "已通过考试，领证 / 认定中", hint: "" },
  { value: "none", label: "还没有教师资格证", hint: "" },
];

export const STAGE_OPTIONS: { value: StageCode; label: string }[] = [
  { value: "primary", label: "小学" },
  { value: "middle", label: "初中" },
  { value: "high", label: "高中" },
];

/**
 * 学科选项。当前仅语文开放匹配；其他学科仅用于识别意向，
 * 选中后不会进入机会匹配（previewEngine 返回 subject_not_open）。
 */
export const SUBJECT_OPTIONS: { value: SubjectCode; label: string }[] = [
  { value: "chinese", label: "语文" },
  { value: "math", label: "数学" },
  { value: "english", label: "英语" },
  { value: "physics", label: "物理" },
  { value: "chemistry", label: "化学" },
  { value: "biology", label: "生物" },
  { value: "politics", label: "道德与法治 / 政治" },
  { value: "history", label: "历史" },
  { value: "geography", label: "地理" },
  { value: "music", label: "音乐" },
  { value: "pe", label: "体育" },
  { value: "art", label: "美术" },
  { value: "it", label: "信息技术" },
  { value: "preschool", label: "幼教" },
  { value: "other", label: "其他学科" },
];

export function subjectLabel(code: SubjectCode | undefined): string {
  if (!code) return "其他学科";
  return SUBJECT_OPTIONS.find((s) => s.value === code)?.label ?? "其他学科";
}

// ==================== 分组完成度（页面“下一步”门禁唯一口径） ====================

/** 每屏信息「用来做什么」的说明（页面逐屏展示，避免用户盲填） */
export const STEP_PURPOSE: Record<number, string> = {
  1: "告诉我们你能接受去哪里。用来圈定地区范围，只看相关地区的招聘机会。",
  2: "核对公告的学历、专业和教师资格门槛。逐条比对，名称不完整或存在解释空间时不会硬判。",
};

/**
 * 「暂不提供」按钮文案与跳过后的结果限制提示。
 * v7.1 M1：第一屏不允许跳过地区（改为"先看看覆盖范围"），只有第二屏可跳过。
 */
export const STEP_SKIP_COPY: Record<
  number,
  { action: string; confirm: string }
> = {
  2: {
    action: "资格条件暂不提供，先跳过",
    confirm: "缺少学历、专业或教师资格信息时，相关岗位只能停留在「补充信息后判断」，不会被当作不符合。",
  },
};

/** 步骤是否被显式跳过 */
export function isStepSkipped(draft: GuestProfileDraft, step: number): boolean {
  return draft.skippedSteps?.includes(step) ?? false;
}

/**
 * 该步骤是否已经填有实质内容（与「跳过」互斥判定用）。
 * 只有内容真实为空时，跳过状态才成立。
 */
export function stepHasContent(draft: GuestProfileDraft, step: number): boolean {
  switch (step) {
    case 1:
      // 地区意向：选了至少一个地区
      return draft.regions.length > 0;
    case 2:
      // 基础资格：学历、专业、毕业时间、教师资格任一项
      return (
        draft.educationLevel !== undefined ||
        (draft.majorFullName ?? "").trim().length > 0 ||
        !!draft.graduationDate ||
        !!draft.teacherCert?.status
      );
    default:
      return false;
  }
}

/**
 * 用户补填内容后自动取消对应步骤的「跳过」标记；
 * 同时清理越界脏值与旧流程残留的 step 1 跳过标记。
 * v7.1 M2：第一屏不允许跳过地区（改为"先看看覆盖范围"），
 * 旧草稿中 step 1 的跳过标记在规整时自动移除。
 */
export function pruneSkippedSteps(draft: GuestProfileDraft): GuestProfileDraft {
  const before = draft.skippedSteps ?? [];
  // 去重 + 限定 2..TOTAL（step 1 不再允许跳过）+ 已有实质内容的步骤自动取消跳过
  const seen = new Set<number>();
  const skipped = before.filter((step) => {
    if (seen.has(step)) return false;
    seen.add(step);
    return step >= 2 && step <= TOTAL_PROFILE_STEPS && !stepHasContent(draft, step);
  });
  if (before.length === skipped.length) return draft;
  return { ...draft, skippedSteps: skipped.length > 0 ? skipped : undefined };
}

export function isStepComplete(draft: GuestProfileDraft, step: number): boolean {
  switch (step) {
    case 1:
      // 地区意向：不允许跳过，必须选择至少一个地区（v7.1 M2 消除"假跳过"）
      return draft.regions.length > 0;
    case 2: {
      // 基础资格：被跳过时已放行
      if (isStepSkipped(draft, step)) return true;
      // 如果开始了教师资格填写，需要补齐 cert 字段（防止半填状态进入结果）
      const cert = draft.teacherCert;
      if (cert && cert.status) {
        if (cert.status === "none") {
          return draft.intendedSubject !== undefined;
        }
        if (!cert.subject || !cert.stage) return false;
        if (cert.status === "in_progress" && !cert.expectedDate) return false;
      }
      // 未跳过且无内容时不算完成（需至少一项或显式跳过）
      return stepHasContent(draft, step);
    }
    default:
      return false;
  }
}

export function isDraftComplete(draft: GuestProfileDraft): boolean {
  for (let step = 1; step <= TOTAL_PROFILE_STEPS; step += 1) {
    if (!isStepComplete(draft, step)) return false;
  }
  return true;
}

/** 意向学科是否在当前开放范围（非语文明确分流，不产生匹配） */
export function isSubjectOpen(draft: GuestProfileDraft): boolean {
  return draft.intendedSubject === OPEN_SUBJECT;
}

/** 一条「结果限制」：因用户暂不提供某组最低必要信息，结论会收窄到什么程度 */
export interface ProfileLimitation {
  step: number;
  /** 该组信息名称，如「能接受的地区」 */
  label: string;
  /** 对结果的具体影响（页面原文展示，必须强调不是不符合） */
  impact: string;
}

const LIMITATION_COPY: Record<number, { label: string; impact: string }> = {
  1: {
    label: "能接受的地区",
    impact:
      "没有地区意向时不会给出任何「初步符合」结果：所有岗位都要等你补充地区后才能判断，这不是不符合。",
  },
  2: {
    label: "学历、专业与教师资格",
    impact: "涉及学历、专业或教师资格门槛的岗位只能停留在「补充信息后判断」，不会被当作不符合。",
  },
};

/**
 * 依据「实际缺失的最低必要信息」（而非跳过标记本身）生成结果限制说明。
 * 只要字段后来补填，限制自动消失。
 */
export function buildProfileLimitations(draft: GuestProfileDraft): ProfileLimitation[] {
  const limitations: ProfileLimitation[] = [];
  for (let step = 1; step <= TOTAL_PROFILE_STEPS; step += 1) {
    if (stepHasContent(draft, step)) continue;
    const copy = LIMITATION_COPY[step];
    if (copy) limitations.push({ step, ...copy });
  }
  return limitations;
}

/**
 * 把完整草稿映射为匹配引擎使用的画像。
 * 条件画像字段（出生/户籍/社保/工作经历）刻意不设置 → 引擎只能判 UNKNOWN。
 * 草稿不完整或学科未开放时返回 null（调用方负责回引导/未开放页）。
 */
export function draftToProfile(draft: GuestProfileDraft): UserRecruitmentProfile | null {
  if (!isDraftComplete(draft)) return null;
  // 非语文学科明确分流；第 5 步整体「暂不提供」时（未选学科）按当前唯一开放的语文处理
  if (draft.intendedSubject !== undefined && !isSubjectOpen(draft)) return null;
  return {
    regions: draft.regions,
    // 被跳过的字段保持 undefined：引擎对缺事实一律判 UNKNOWN，不得伪造默认值
    educationLevel: draft.educationLevel,
    degree: draft.degree,
    majorFullName: draft.majorFullName?.trim() || undefined,
    graduationDate: draft.graduationDate,
    employmentStatus: draft.employmentStatus,
    teacherCert: draft.teacherCert,
    acceptedEmploymentNatures: draft.acceptedEmploymentNatures,
  };
}

/** 展示机会结果的最低门槛：至少知道用户愿意去哪里。 */
export function hasMinimumPreviewProfile(draft: GuestProfileDraft): boolean {
  return draft.regions.length > 0;
}

/**
 * v7.1 M2 迁移：旧 3 步/5 步草稿的 session.step 值归入新 2 步范围。
 * - old step 0 → 0（未开始）
 * - old step 1 → 1（完成地区意向）
 * - old step 2 → 2（完成基础资格）
 * - old step 3+ → 2（旧"补充信息"步骤已取消，视为完成）
 */
export function migrateSessionStep(step: number): number {
  return Math.min(step, TOTAL_PROFILE_STEPS);
}

// ==================== 会话存储服务 ====================

export const guestSessionService = {
  /** 读取访客画像会话；不存在或已过期时返回 null（过期会同时清除）。
   *  v7.1 M2：加载时自动迁移旧 3 步/5 步草稿的 step 值到 2 步范围。 */
  load(): GuestProfileSession | null {
    const session = loadFromStorage<GuestProfileSession | null>(
      STORAGE_KEYS.GUEST_PROFILE_V61,
      null,
    );
    if (!session) return null;
    if (isExpired(session)) {
      removeFromStorage(STORAGE_KEYS.GUEST_PROFILE_V61);
      return null;
    }
    // 迁移旧 step 值；同时规整跳过标记（移除旧 step 1/3 的残留）
    const migratedStep = migrateSessionStep(session.step);
    const migratedDraft = pruneSkippedSteps(session.draft);
    if (migratedStep !== session.step || migratedDraft !== session.draft) {
      const next = { ...session, step: migratedStep, draft: migratedDraft };
      try {
        saveToStorageStrict(STORAGE_KEYS.GUEST_PROFILE_V61, next);
      } catch {
        // 存储不可用时返回迁移后的值（不阻塞读取）
      }
      return next;
    }
    return session;
  },

  /**
   * 创建或更新会话（草稿浅合并，整组覆盖；可随时返回修改）。
   * 规整「跳过」标记后严格写入：存储不可用/超限时抛出，
   * 调用方必须捕获并提示用户——此时页面上的输入仍保留在 React 状态中，不会丢失。
   */
  save(patch: { draft?: Partial<GuestProfileDraft>; step?: number }): GuestProfileSession {
    const existing = this.load();
    const now = new Date().toISOString();
    const mergedDraft = pruneSkippedSteps({
      ...emptyDraft(),
      ...existing?.draft,
      ...patch.draft,
    });
    const next: GuestProfileSession = {
      draft: mergedDraft,
      step: patch.step ?? existing?.step ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: existing?.expiresAt ?? new Date(Date.now() + GUEST_TTL_MS).toISOString(),
    };
    saveToStorageStrict(STORAGE_KEYS.GUEST_PROFILE_V61, next);
    return next;
  },

  /** 是否已开始但未完成五组采集 */
  isInProgress(): boolean {
    const s = this.load();
    return !!s && s.step > 0 && s.step < TOTAL_PROFILE_STEPS;
  },

  /** 是否已完成五组采集（含非语文学科的终态），可以查看初步结果 */
  isComplete(): boolean {
    const s = this.load();
    return !!s && s.step >= TOTAL_PROFILE_STEPS;
  },

  clear(): void {
    removeFromStorage(STORAGE_KEYS.GUEST_PROFILE_V61);
  },
};
