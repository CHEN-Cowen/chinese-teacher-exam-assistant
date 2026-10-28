/**
 * 保存后的下一步选择器（v7.2 FR-2，纯函数）。
 *
 * 保存（considering）后，保存区域只展示「唯一一个最高优先级主动作」：
 *   Tier 1 影响报名的硬阻塞（hard FAIL → hard MANUAL_REVIEW）
 *   Tier 2 72 小时内的官方日程节点（取最早）
 *   Tier 3 缺失信息（hard UNKNOWN）→ 必填材料 → 选填材料
 *   Tier 4 72 小时之后的未来日程节点（取最早）
 *   Tier 5 日期未公布、等待官方通知的节点（固定 kind 优先序）
 *
 * 约束：纯函数、不读系统时钟（nowIso 入参）、不发请求、同输入同输出。
 * 已被用户消解（官方确认符合）的 MANUAL_REVIEW 阻塞不再出现；已完成/不适用的
 * 材料不再出现；闸门异常（截止/撤回/待复核等）时保存区不与 Hero 官方出口竞争。
 */
import type {
  DimensionDTO,
  FollowDTO,
  GateDTO,
  MaterialItemDTO,
  UnitMatchDTO,
} from "./api-types";
import { primaryGate } from "./detail-view";
import { dimensionLabel } from "@/lib/ia/labels";
import { parseConsultationAnswer } from "./consultation-answer";

export type SavedNextActionKind =
  | "resolve_blocker" // Tier 1
  | "urgent_node" // Tier 2
  | "supplement_info" // Tier 3（UNKNOWN 维度）
  | "prepare_material" // Tier 3（材料）
  | "schedule_node" // Tier 4
  | "await_notice"; // Tier 5

export interface TimelineCandidate {
  /** 与后端 TimelineEventKind 枚举同名（pending_notice=待官方通知） */
  kind: string;
  /** 节点中文名称；pending_notice 为公告原文中的待通知事项 */
  label: string;
  /** YYYY-MM-DD；null=官方未公布日期，绝不臆造 */
  dateIso: string | null;
  /** 适配器提供的出口（如报名截止→官方报名入口）；缺省走日程页 */
  href?: string;
  external?: boolean;
  /** 稳定身份；缺省用 `${kind}:${dateIso ?? "pending"}` */
  key?: string;
}

export interface SelectorInput {
  gates: GateDTO[];
  follow: FollowDTO | null;
  dimensions: DimensionDTO[];
  materials: MaterialItemDTO[];
  events: TimelineCandidate[];
}

export interface SavedNextAction {
  tier: 1 | 2 | 3 | 4 | 5;
  kind: SavedNextActionKind;
  /** 稳定身份：dim:{requirementId} / mat:{materialId} / event key */
  key: string;
  label: string;
  /** 安静次要信息（日期、进度等，不与主按钮竞争） */
  detail?: string;
  href?: string;
  external?: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const URGENT_WINDOW_MS = 72 * HOUR_MS;
const FINISHED_MATERIAL_STATUSES = new Set(["done", "not_applicable"]);
const INACTIVE_FOLLOW_STATUSES = new Set([
  "registered",
  "waiting_exam",
  "abandoned",
  "closed",
]);
/** Tier 5 待通知节点的固定 kind 优先序，其余 kind 按 events 数组顺序兜底 */
const AWAIT_PRIORITY = [
  "registration_end",
  "registration_start",
  "qualification_review",
  "written_exam",
  "interview",
];

/** 日历日（YYYY-MM-DD）按本地零点解析，与后端 daysUntil 口径一致 */
function dateToTime(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00`).getTime();
}

function formatMd(dateIso: string): string {
  const [, month, day] = dateIso.split("-");
  return month && day ? `${Number(month)}月${Number(day)}日` : dateIso;
}

function remainingText(deltaMs: number): string {
  if (deltaMs < HOUR_MS) return "今天截止";
  const hours = Math.floor(deltaMs / HOUR_MS);
  if (hours < 24) return `还剩 ${hours} 小时`;
  return `还剩 ${Math.ceil(deltaMs / DAY_MS)} 天`;
}

/** 该维度是否已有用户本人的「官方确认符合」结构化答复（仅按 dimension 键查） */
function isBlockerResolvedByUser(
  dimension: DimensionDTO,
  follow: FollowDTO,
): boolean {
  const raw = follow.consultationNotes?.[dimension.dimension];
  if (!raw) return false;
  return parseConsultationAnswer(raw).outcome === "confirmed_match";
}

function selectBlocker(input: SelectorInput): SavedNextAction | null {
  const follow = input.follow;
  if (!follow) return null;
  // 组内固定次序：hard FAIL 先于 hard MANUAL_REVIEW，再按 dimensions 原始顺序
  for (const value of ["FAIL", "MANUAL_REVIEW"] as const) {
    for (const dimension of input.dimensions) {
      if (
        dimension.hard === true &&
        dimension.value === value &&
        !isBlockerResolvedByUser(dimension, follow)
      ) {
        if (value === "FAIL") {
          return {
            tier: 1,
            kind: "resolve_blocker",
            key: `dim:${dimension.requirementId}`,
            label: "查看影响你报名的条件",
            detail: `不符合项：${dimensionLabel(dimension.dimension)}`,
            href: `#condition-${dimension.requirementId}`,
          };
        }
        return {
          tier: 1,
          kind: "resolve_blocker",
          key: `dim:${dimension.requirementId}`,
          label: `向招聘单位确认：${dimensionLabel(dimension.dimension)}`,
          href: "#to-confirm",
        };
      }
    }
  }
  return null;
}

interface DatedCandidate extends TimelineCandidate {
  index: number;
  time: number;
}

function datedEvents(events: TimelineCandidate[]): DatedCandidate[] {
  const out: DatedCandidate[] = [];
  events.forEach((event, index) => {
    if (!event.dateIso) return;
    out.push({ ...event, index, time: dateToTime(event.dateIso) });
  });
  return out;
}

function eventKey(event: TimelineCandidate): string {
  return event.key ?? `${event.kind}:${event.dateIso ?? "pending"}`;
}

function toEventAction(
  tier: 2 | 4,
  event: DatedCandidate,
  now: number,
): SavedNextAction {
  if (tier === 2) {
    return {
      tier,
      kind: "urgent_node",
      key: eventKey(event),
      label: `${event.label}（${remainingText(event.time - now)}）`,
      detail: `${event.label}：${formatMd(event.dateIso as string)}`,
      href: event.href ?? "/schedule",
      external: event.external,
    };
  }
  return {
    tier,
    kind: "schedule_node",
    key: eventKey(event),
    label: `查看日程：${event.label}`,
    detail: `${event.label}：${formatMd(event.dateIso as string)}`,
    href: event.href ?? "/schedule",
    external: event.external,
  };
}

/** 最早节点（同时间保持 events 数组顺序） */
function earliest(candidates: DatedCandidate[]): DatedCandidate | null {
  return candidates.reduce<DatedCandidate | null>((acc, cur) => {
    if (!acc) return cur;
    return cur.time < acc.time || (cur.time === acc.time && cur.index < acc.index)
      ? cur
      : acc;
  }, null);
}

function selectMissingInfo(input: SelectorInput): SavedNextAction | null {
  // ① hard 的 UNKNOWN 维度（数组顺序）
  for (const dimension of input.dimensions) {
    if (dimension.hard === true && dimension.value === "UNKNOWN") {
      return {
        tier: 3,
        kind: "supplement_info",
        key: `dim:${dimension.requirementId}`,
        label: `补充信息：${dimensionLabel(dimension.dimension)}`,
        href: "#missing-info",
      };
    }
  }
  return null;
}

function selectMaterial(
  materials: MaterialItemDTO[],
  statuses: Record<string, string> | null,
  required: boolean,
): SavedNextAction | null {
  const scoped = materials.filter((m) => m.required === required);
  const total = scoped.length;
  let doneCount = 0;
  let firstPending: MaterialItemDTO | null = null;
  for (const material of scoped) {
    const status = statuses?.[material.id];
    if (status && FINISHED_MATERIAL_STATUSES.has(status)) {
      doneCount += 1;
    } else if (!firstPending) {
      firstPending = material;
    }
  }
  if (!firstPending) return null;
  return {
    tier: 3,
    kind: "prepare_material",
    key: `mat:${firstPending.id}`,
    label: `准备材料：${firstPending.label}（${doneCount}/${total}）`,
    href: "#materials",
  };
}

function selectAwaitNotice(events: TimelineCandidate[]): SavedNextAction | null {
  const pending = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.dateIso === null);
  if (pending.length === 0) return null;
  const rankOf = (kind: string) => {
    const rank = AWAIT_PRIORITY.indexOf(kind);
    return rank === -1 ? AWAIT_PRIORITY.length : rank;
  };
  pending.sort((a, b) => {
    const ra = rankOf(a.event.kind);
    const rb = rankOf(b.event.kind);
    return ra !== rb ? ra - rb : a.index - b.index;
  });
  const chosen = pending[0].event;
  return {
    tier: 5,
    kind: "await_notice",
    key: eventKey(chosen),
    label: `${chosen.label}日期未公布：查看日程提醒`,
    href: "/schedule",
  };
}

/**
 * 计算保存区域唯一主动作；无候选返回 null（面板只显示已保存态与撤销，不硬造动作）。
 */
export function selectSavedNextAction(
  input: SelectorInput,
  nowIso: string,
): SavedNextAction | null {
  const { follow } = input;
  if (!follow) return null;
  if (INACTIVE_FOLLOW_STATUSES.has(follow.status)) return null;
  // 闸门异常（截止/撤回/待复核/来源失效等）：Hero 官方出口优先，保存区不竞争
  if (primaryGate(input.gates)) return null;

  // Tier 1：影响报名的硬阻塞
  const blocker = selectBlocker(input);
  if (blocker) return blocker;

  const now = new Date(nowIso).getTime();
  const dated = datedEvents(input.events);
  const future = dated.filter((e) => e.time >= now);

  // Tier 2：72 小时内节点（含此刻；已过去的节点排除）
  const urgent = future.filter((e) => e.time - now <= URGENT_WINDOW_MS);
  const urgentFirst = earliest(urgent);
  if (urgentFirst) return toEventAction(2, urgentFirst, now);

  // Tier 3：缺失信息 → 必填材料 → 选填材料
  const missingInfo = selectMissingInfo(input);
  if (missingInfo) return missingInfo;
  const statuses = follow.materialStatuses ?? null;
  const requiredMaterial = selectMaterial(input.materials, statuses, true);
  if (requiredMaterial) return requiredMaterial;
  const optionalMaterial = selectMaterial(input.materials, statuses, false);
  if (optionalMaterial) return optionalMaterial;

  // Tier 4：72 小时之后的未来最早节点
  const later = future.filter((e) => e.time - now > URGENT_WINDOW_MS);
  const laterFirst = earliest(later);
  if (laterFirst) return toEventAction(4, laterFirst, now);

  // Tier 5：待官方通知节点
  return selectAwaitNotice(input.events);
}

/**
 * DTO 时间线 → 选择器候选适配器。
 *
 * UnitMatchDTO.version.timeline 只携带 7 个日期字段（少于后端 generateEvents 的
 * 18 种节点）；这里仅映射 DTO 实际存在的字段 + pendingItems，null 日期不臆造。
 * 报名截止节点附官方出口（岗位登记的报名入口优先，其次公告原文链接）。
 */
const DTO_TIMELINE_FIELDS: Array<{
  field: keyof UnitMatchDTO["version"]["timeline"];
  kind: string;
  label: string;
}> = [
  { field: "registrationStart", kind: "registration_start", label: "报名开始" },
  { field: "registrationEnd", kind: "registration_end", label: "报名截止" },
  { field: "paymentDeadline", kind: "payment", label: "缴费截止" },
  { field: "admitTicketStart", kind: "admit_ticket", label: "准考证打印开始" },
  { field: "writtenExamDate", kind: "written_exam", label: "笔试" },
  { field: "scoreDate", kind: "score", label: "成绩查询" },
  { field: "interviewDate", kind: "interview", label: "面试" },
];

export function timelineCandidatesFromUnit(unit: UnitMatchDTO): TimelineCandidate[] {
  const timeline = unit.version.timeline;
  const candidates: TimelineCandidate[] = [];
  for (const { field, kind, label } of DTO_TIMELINE_FIELDS) {
    const dateIso = timeline[field];
    if (typeof dateIso !== "string" || dateIso === "") continue;
    const candidate: TimelineCandidate = {
      kind,
      label,
      dateIso,
      key: kind,
    };
    if (kind === "registration_end") {
      const registerEntry = unit.unit.registerUrl ?? unit.announcement.officialUrl;
      if (registerEntry) {
        candidate.href = registerEntry;
        candidate.external = true;
      }
    }
    candidates.push(candidate);
  }
  for (const [index, item] of (timeline.pendingItems ?? []).entries()) {
    candidates.push({
      kind: "pending_notice",
      label: item,
      dateIso: null,
      key: `pending_notice:${index}`,
    });
  }
  return candidates;
}
