/**
 * 日程页视图模型（模块 6）。
 *
 * 事件由后端从已发布公告版本同步生成（含去重、变更留痕、静音隔离），
 * 本模块是纯函数：把扁平的 TimelineEventDTO 数组按机会分组、
 * 选出“下一件不能错过的事”、识别时间冲突。不访问网络、不读状态。
 *
 * 时间未定一律 pending=true，展示“待官方通知”，禁止推测日期。
 */
import type {
  ScheduleUrgency,
  TimelineEventDTO,
  TimelineEventKind,
  UnitTrustDTO,
} from "@/lib/schedule/types";

/** 日程事件 = 后端 DTO（视图层不重新派生强度/日期） */
export type ScheduleEvent = TimelineEventDTO;

export interface ScheduleGroup {
  unitId: string;
  title: string;
  regionText: string;
  events: ScheduleEvent[];
  /** 机会可信状态（模块 7）：降级时组头展示，事件行动已在后端降级 */
  trust: UnitTrustDTO | null;
}

export interface NextScheduleItem {
  event: ScheduleEvent;
  groupTitle: string;
  regionText: string;
}

/** 时间冲突：同一天有多个机会的节点（不替用户自动放弃，只提示） */
export interface ScheduleConflict {
  dateIso: string;
  dateText: string;
  items: { unitName: string; kindLabel: string; event: ScheduleEvent }[];
}

export interface ScheduleView {
  /** 第一层：下一件不能错过的事；无关注/无待办时为 null */
  next: NextScheduleItem | null;
  groups: ScheduleGroup[];
  /** 同一天跨多个机会的节点（提示用，不自动放弃） */
  conflicts: ScheduleConflict[];
}

const KIND_ORDER: TimelineEventKind[] = [
  "registration_start",
  "registration_end",
  "preliminary_review",
  "review_result",
  "payment",
  "amendment_deadline",
  "admit_ticket",
  "admit_ticket_end",
  "written_exam",
  "score",
  "score_review",
  "qualification_review",
  "interview_confirm",
  "interview",
  "medical_exam",
  "inspection",
  "position_selection",
  "publication",
  "pending_notice",
];

const URGENCY_RANK: Record<ScheduleUrgency, number> = {
  must: 0,
  suggest: 1,
  info: 2,
};

export function buildScheduleView(
  events: ScheduleEvent[],
  unitTrust: Record<string, UnitTrustDTO> = {},
): ScheduleView {
  // 按机会分组（后端已保证每个 unitId 对应同一公告版本的事件）
  const groupMap = new Map<string, ScheduleGroup>();
  for (const event of events) {
    let group = groupMap.get(event.unitId);
    if (!group) {
      group = {
        unitId: event.unitId,
        title: event.unitName,
        regionText: event.regionText,
        events: [],
        trust: unitTrust[event.unitId] ?? null,
      };
      groupMap.set(event.unitId, group);
    }
    group.events.push(event);
  }

  const groups = Array.from(groupMap.values()).map((g) => ({
    ...g,
    events: [...g.events].sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (byKind !== 0) return byKind;
      return (a.dateIso ?? "").localeCompare(b.dateIso ?? "");
    }),
  }));

  // 下一件：尚未过去、带行动、有明确日期的事件；must > suggest > info，同档比日期
  const upcoming = groups
    .flatMap((g) =>
      g.events
        .filter((e) => e.action && !e.past && e.dateIso)
        .map((event) => ({
          event,
          groupTitle: g.title,
          regionText: g.regionText,
        })),
    )
    .sort((a, b) => {
      const byUrgency =
        URGENCY_RANK[a.event.urgency] - URGENCY_RANK[b.event.urgency];
      if (byUrgency !== 0) return byUrgency;
      return (a.event.dateIso ?? "").localeCompare(b.event.dateIso ?? "");
    });

  // 冲突：同一 dateIso（非空）出现在多个 unitId
  const byDate = new Map<string, ScheduleConflict>();
  for (const event of events) {
    if (!event.dateIso || event.past) continue;
    const existing = byDate.get(event.dateIso);
    const item = {
      unitName: event.unitName,
      kindLabel: event.kindLabel,
      event,
    };
    if (existing) {
      existing.items.push(item);
    } else {
      byDate.set(event.dateIso, {
        dateIso: event.dateIso,
        dateText: event.dateText,
        items: [item],
      });
    }
  }
  const conflicts = Array.from(byDate.values())
    .filter((c) => {
      const unitIds = new Set(c.items.map((i) => i.event.unitId));
      return unitIds.size > 1;
    })
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  return { next: upcoming[0] ?? null, groups, conflicts };
}
