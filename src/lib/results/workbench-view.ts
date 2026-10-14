/**
 * v7.2 统一结果工作台展示模型（共享 ViewModel + 双向适配器）。
 *
 * 为什么存在：`/preview`（访客）的数据是 previewEngine 推导的 OpportunityRow，
 * `/opportunities`（登录）的数据是后端 UnitMatchDTO，两者形状不同。
 * 本模块把两种来源转换成同一个 OpportunityCardViewModel，
 * 让 ResultsWorkbench / UnifiedOpportunityCard 只有一份实现：
 * 身份只影响数据来源与操作能力，不影响页面结构与卡片 DOM。
 *
 * 分类互斥（三标签 + 留档区）：
 * - 登录端复用 classifyOpportunity（v7.2 单一事实源）；
 * - 访客端由 classifyGuestRow 镜像同一套规则（闸门失败→留档；初步符合→优先；
 *   待补信息/建议确认→补充后判断；仅地区或用工偏好不匹配→偏好范围外；
 *   其他明确不符合→留档），同一个岗位只会进入一个正常标签。
 */
import type {
  OpportunityMatchStatus,
  UnitMatchDTO,
} from "@/lib/opportunities/api-types";
import type {
  DimensionView,
  OpportunityRow,
} from "@/lib/ia/opportunities-view";
import type { GuestPreviewReady } from "@/lib/guest/previewEngine";
import type { WorkbenchViewModel } from "@/lib/opportunities/list-view";
import {
  buildMapEntry,
  type MapEntry,
} from "@/lib/opportunities/map-link";
import { deriveSchoolDisplay } from "@/lib/opportunities/school-placement";
import { primaryFailedGate } from "@/lib/gate-states";
import {
  deadlineText,
  natureShortLabel,
  regionLabel,
  stageSubjectLabel,
} from "@/lib/ia/labels";

/** 工作台三个互斥标签（与 URL ?tab= 语义一致，/preview 与 /opportunities 共用） */
export type ResultsTabId = "priority" | "supplement" | "outOfScope";

/** 卡片视觉变体：excluded 只出现在留档区 */
export type ResultsCardVariant = ResultsTabId | "excluded";

/**
 * 统一岗位卡展示模型。所有字段都是「可直接渲染」的字符串/枚举，
 * 卡片组件不再理解 UnitMatchDTO 或 OpportunityRow。
 */
export interface OpportunityCardViewModel {
  id: string;
  dataset: "demo" | "real";
  /** 第 1 层：真实/演示标识文案（虚构试用示例 / 真实公告 · 已人工核对 …） */
  reviewLabel: string;
  /** 第 2 层：岗位或学校名称 */
  title: string;
  /** 标题链接：登录端有详情页，访客端为 null（标题不跳转） */
  titleHref: string | null;
  /** 第 1 层右侧：截止文案（含「报名」前缀） */
  deadlineText: string;
  deadlineClosed: boolean;
  /** 第 3 层：地点（省市区，未公布的层级省略） */
  locationText: string;
  /** 第 3 层：任教学校（官方逐校列明时为校名；否则为官方口径说明） */
  schoolText: string;
  /** 第 3 层右侧：地图入口；无明确城市时为 null（只隐藏链接，地点文字保留） */
  mapEntry: MapEntry | null;
  /** 第 4 层：用工形式 */
  employmentNatureText: string;
  /** 第 4 层：学段学科 */
  stageSubjectText: string;
  /** 第 4 层：招聘人数 */
  headcount: number;
  /** 四档匹配状态（卡片状态标签用） */
  status: OpportunityMatchStatus;
  /** 建议向招聘单位确认（MANUAL_REVIEW）：补充后判断桶内的专属子态 */
  isConsult: boolean;
  /** 建议确认的第一个问题（consult 态展示） */
  consultQuestion: string | null;
  /** 第 5 层：已通过条件数 */
  passedCount: number;
  /** 第 6 层：一个关键风险或待补信息（无则 null） */
  pendingRisk: string | null;
  /** 第 6 层：关键提醒（闸门原因或一句话摘要） */
  summary: string;
  /** 闸门失败（留档区）：code + 原因 */
  closedGate: { code: string; reason: string } | null;
  /** 登录端：已保存（follow != null） */
  saved: boolean;
  /** 官方公告链接（展开依据/外部跳转用；已经过调用方安全处理） */
  officialUrl: string | null;
  /** 逐项条件依据（访客展开演示依据面板用；登录端为 null，依据在详情页） */
  dimensions: DimensionView[] | null;
  /** 访客「只看事业编」偏好筛除标记：不是资格不符合，进偏好范围外标签 */
  natureOutOfPreference: boolean;
}

/** 留档区分组（已截止 / 来源失效 / 明确不符合等） */
export interface ArchivedResultGroup {
  key: string;
  label: string;
  cards: OpportunityCardViewModel[];
}

/** 统一结果工作台视图模型 */
export interface ResultsWorkbenchViewModel {
  /** 当前条件摘要项目（已过滤空项，组件用「 · 」连接） */
  conditions: string[];
  /** 「修改」入口（/onboarding?mode=edit&step=2&returnTo=…） */
  editHref: string;
  tabs: Record<ResultsTabId, OpportunityCardViewModel[]>;
  archived: ArchivedResultGroup[];
}

/* ================== 登录端适配器（UnitMatchDTO → CardViewModel） ================== */

export function unitMatchToCardView(
  unit: UnitMatchDTO,
  evaluatedAt: string,
): OpportunityCardViewModel {
  const closedGate = primaryFailedGate(unit.gates);
  const deadline = deadlineText(
    unit.version.timeline.registrationEnd,
    evaluatedAt,
  );
  const locationText = regionLabel(unit.unit.region);
  const school = deriveSchoolDisplay(unit.unit);
  const pending = unit.dimensions.find(
    (d) => d.value === "UNKNOWN" || d.value === "MANUAL_REVIEW",
  );
  const isConsult =
    unit.overall === "manual_review" && closedGate === null;

  return {
    id: unit.unit.id,
    dataset: unit.announcement.dataset,
    reviewLabel:
      unit.announcement.dataset === "demo"
        ? "虚构试用示例"
        : unit.announcement.reviewStatus === "human_reviewed"
          ? "真实公告 · 已人工核对"
          : "真实记录 · AI 初核待人工复核",
    title: unit.unit.name,
    titleHref: `/opportunities/${unit.unit.id}`,
    deadlineText: `报名${deadline.text}`,
    deadlineClosed: deadline.closed,
    locationText,
    schoolText: school.known ? school.schoolName! : school.note!,
    mapEntry: buildMapEntry({
      city: unit.unit.region.city,
      district: unit.unit.region.district,
      schoolPlacement: unit.unit.schoolPlacement,
    }),
    employmentNatureText: natureShortLabel(
      unit.unit.employmentNature.code as never,
    ),
    stageSubjectText: stageSubjectLabel(unit.unit.stage, unit.unit.subject),
    headcount: unit.unit.headcount,
    status: unit.overall,
    isConsult,
    consultQuestion: isConsult
      ? (unit.consultationTemplates?.[0]?.question ?? null)
      : null,
    passedCount: unit.dimensions.filter((d) => d.value === "PASS").length,
    pendingRisk: pending ? pending.reason : null,
    summary: closedGate ? closedGate.reason : unit.summary,
    closedGate: closedGate
      ? { code: closedGate.code, reason: closedGate.reason }
      : null,
    saved: unit.follow != null,
    officialUrl: unit.announcement.officialUrl || null,
    dimensions: null,
    natureOutOfPreference: false,
  };
}

/** 登录端三标签数据：对 WorkbenchViewModel 跑共享适配器（分类由 classifyOpportunity 保证） */
export function buildUnitTabs(
  workbench: WorkbenchViewModel,
  evaluatedAt: string,
): Record<ResultsTabId, OpportunityCardViewModel[]> {
  const map = (units: UnitMatchDTO[]) =>
    units.map((u) => unitMatchToCardView(u, evaluatedAt));
  return {
    priority: map(workbench.priority.units),
    supplement: map(workbench.supplement.units),
    outOfScope: map(workbench.outOfScope.units),
  };
}

/* ================== 访客端分类（镜像 classifyOpportunity 规则） ================== */

export interface GuestClassification {
  tab: ResultsTabId | "excluded";
  supplementVariant: "unknown" | "consult" | null;
}

/**
 * 访客 OpportunityRow 分类。与 classifyOpportunity 同规则、同优先级：
 * 1. 闸门失败（已截止/来源失效/未开放等）→ excluded；
 * 2. 用工偏好筛除（只看事业编）→ outOfScope（偏好，不是资格不符合）；
 * 3. preliminary_eligible → priority；
 * 4. need_more_info → supplement/unknown；
 * 5. manual_review → supplement/consult（卡片显示「建议官方确认」）；
 * 6. not_eligible 且仅地区不匹配（由 view.regionOutOfScope 标出）→ outOfScope；
 * 7. not_eligible 其他 → excluded。
 */
export function classifyGuestRow(
  row: OpportunityRow,
  ctx: { natureOut: ReadonlySet<string>; regionOut: ReadonlySet<string> },
): GuestClassification {
  if (row.gateCode !== null || row.registrationClosed) {
    return { tab: "excluded", supplementVariant: null };
  }
  if (ctx.natureOut.has(row.unitId)) {
    return { tab: "outOfScope", supplementVariant: null };
  }
  switch (row.status) {
    case "preliminary_eligible":
      return { tab: "priority", supplementVariant: null };
    case "need_more_info":
      return { tab: "supplement", supplementVariant: "unknown" };
    case "manual_review":
      return { tab: "supplement", supplementVariant: "consult" };
    case "not_eligible":
      if (ctx.regionOut.has(row.unitId)) {
        return { tab: "outOfScope", supplementVariant: null };
      }
      return { tab: "excluded", supplementVariant: null };
    default:
      return { tab: "excluded", supplementVariant: null };
  }
}

/* ================== 访客端适配器（OpportunityRow → CardViewModel） ================== */

export function guestRowToCardView(
  row: OpportunityRow,
  options: { natureOutOfPreference?: boolean } = {},
): OpportunityCardViewModel {
  const school = deriveSchoolDisplay({
    allocation: { code: row.allocationCode },
    schoolPlacement: row.schoolPlacement,
  });
  const pending = row.dimensions.find(
    (d) => d.value === "UNKNOWN" || d.value === "MANUAL_REVIEW",
  );
  const isConsult = row.status === "manual_review" && row.gateCode === null;

  return {
    id: row.unitId,
    // 访客 seed 全部是虚构演示示例，绝不能伪装成真实招聘
    dataset: "demo",
    reviewLabel: "虚构试用示例",
    title: row.unitName,
    titleHref: null,
    deadlineText: `报名${row.deadline}`,
    deadlineClosed: row.registrationClosed,
    locationText: row.regionFullText || row.regionText,
    schoolText: school.known ? school.schoolName! : school.note!,
    mapEntry: buildMapEntry({
      city: row.region.city,
      district: row.region.district,
      schoolPlacement: row.schoolPlacement,
    }),
    employmentNatureText: natureShortLabel(row.natureCode),
    stageSubjectText: row.subjectText || row.stageText,
    headcount: row.headcount,
    status: row.status,
    isConsult,
    consultQuestion: null,
    passedCount: row.dimensions.filter((d) => d.value === "PASS").length,
    pendingRisk: pending ? pending.reason : null,
    summary: row.gateReason ?? row.oneLineReason,
    closedGate:
      row.gateCode !== null
        ? { code: row.gateCode, reason: row.gateReason ?? "" }
        : null,
    saved: false,
    officialUrl: row.officialUrl || null,
    dimensions: row.dimensions,
    natureOutOfPreference: options.natureOutOfPreference === true,
  };
}

/**
 * 访客端三标签 + 留档区（单一事实源）。
 * 输入是 buildGuestPreview 的完整视图：preliminary / needInfoGroups / manualReview /
 * notEligible / regionOutOfScope / closedBuckets / natureOutOfPreference。
 * 先按 unitId 去重（priority 同时出现在 preliminary），再逐张分类，
 * 保证同一岗位只进入一个正常标签。
 */
export function buildGuestWorkbenchTabs(preview: GuestPreviewReady): {
  tabs: Record<ResultsTabId, OpportunityCardViewModel[]>;
  archived: ArchivedResultGroup[];
} {
  const { view } = preview;
  const natureOut = new Set(preview.natureOutOfPreference.map((r) => r.unitId));
  const regionOut = new Set(view.regionOutOfScope.map((r) => r.unitId));

  // 收集全部候选行，按 unitId 去重（保持首次出现顺序）
  const allRows = new Map<string, OpportunityRow>();
  const push = (row: OpportunityRow) => {
    if (!allRows.has(row.unitId)) allRows.set(row.unitId, row);
  };
  if (view.priority) push(view.priority);
  view.preliminary.forEach(push);
  view.needInfoGroups.forEach((group) => group.rows.forEach(push));
  view.manualReview.forEach(push);
  preview.natureOutOfPreference.forEach(push);
  view.regionOutOfScope.forEach(push);
  view.notEligible.forEach(push);
  view.closedBuckets.forEach((bucket) => bucket.rows.forEach(push));

  const tabs: Record<ResultsTabId, OpportunityCardViewModel[]> = {
    priority: [],
    supplement: [],
    outOfScope: [],
  };
  const excluded = new Map<string, OpportunityCardViewModel>();

  for (const row of allRows.values()) {
    const result = classifyGuestRow(row, { natureOut, regionOut });
    const card = guestRowToCardView(row, {
      natureOutOfPreference: natureOut.has(row.unitId),
    });
    if (result.tab === "excluded") {
      excluded.set(row.unitId, card);
    } else {
      tabs[result.tab].push(card);
    }
  }

  // 留档区：closedBuckets 保持稳定分桶标签；其余 excluded 归「条件暂不符合」
  const archived: ArchivedResultGroup[] = [];
  const bucketed = new Set<string>();
  for (const bucket of view.closedBuckets) {
    const cards = bucket.rows
      .filter((row) => excluded.has(row.unitId))
      .map((row) => {
        bucketed.add(row.unitId);
        return excluded.get(row.unitId)!;
      });
    if (cards.length > 0) {
      archived.push({ key: bucket.key, label: bucket.label, cards });
    }
  }
  const rest = [...excluded.entries()]
    .filter(([unitId]) => !bucketed.has(unitId))
    .map(([, card]) => card);
  if (rest.length > 0) {
    archived.push({ key: "not_eligible", label: "条件暂不符合", cards: rest });
  }

  return { tabs, archived };
}
