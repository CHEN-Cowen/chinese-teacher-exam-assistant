/**
 * 保存后的下一步选择器测试（v7.2 FR-2）。
 *
 * 覆盖：前置短路；五级逐级优先；同级确定排序；恒只输出一个动作；
 * nowIso 推进使节点在 T2/T4/过期之间移动；材料完成后消失；
 * confirmed_match 消解阻塞、其余答复不消解；闸门优先；待通知 kind 优先序；
 * 纯函数确定性；DTO 时间线适配器。
 */
import { describe, expect, it } from "vitest";
import {
  selectSavedNextAction,
  timelineCandidatesFromUnit,
  type SelectorInput,
  type TimelineCandidate,
} from "./next-action-selector";
import { encodeConsultationAnswer } from "./consultation-answer";
import type {
  DimensionDTO,
  FollowDTO,
  GateDTO,
  MaterialItemDTO,
  UnitMatchDTO,
} from "./api-types";

const NOW = "2026-10-12T00:00:00"; // 本地零点，72h 边界可手算

function follow(over: Partial<FollowDTO> = {}): FollowDTO {
  return {
    id: "follow-1",
    unitId: "unit-1",
    announcementId: "ann-1",
    versionId: "ver-1",
    status: "considering",
    role: null,
    followedAt: "2026-10-12T08:00:00+08:00",
    statusHistory: [],
    abandonReason: null,
    newerVersion: false,
    version: 1,
    materialStatuses: null,
    consultationNotes: null,
    ...over,
  };
}

function dimension(over: Partial<DimensionDTO> = {}): DimensionDTO {
  return {
    requirementId: "req-major",
    dimension: "major",
    value: "UNKNOWN",
    reason: "",
    hard: true,
    ...over,
  };
}

function material(over: Partial<MaterialItemDTO> = {}): MaterialItemDTO {
  return {
    id: "mat-id",
    label: "身份证",
    source: {
      id: "ev-1",
      locator: { kind: "url", url: "https://example.gov.cn/a" },
      state: "official",
      checkedAt: "2026-10-01T00:00:00+08:00",
    },
    applicableAudience: "全部",
    required: true,
    ...over,
  };
}

function gate(over: Partial<GateDTO> = {}): GateDTO {
  return {
    code: "registration_closed",
    passed: false,
    reason: "报名已截止",
    ...over,
  };
}

function event(over: Partial<TimelineCandidate> = {}): TimelineCandidate {
  return {
    kind: "written_exam",
    label: "笔试",
    dateIso: "2026-10-20",
    key: "written_exam",
    ...over,
  };
}

function input(over: Partial<SelectorInput> = {}): SelectorInput {
  return {
    gates: [],
    follow: follow(),
    dimensions: [],
    materials: [],
    events: [],
    ...over,
  };
}

describe("前置短路", () => {
  it("follow 为 null → null（未保存不出保存区动作）", () => {
    expect(selectSavedNextAction(input({ follow: null }), NOW)).toBeNull();
  });

  for (const status of ["registered", "abandoned", "closed"] as const) {
    it(`follow.status=${status} → null`, () => {
      expect(
        selectSavedNextAction(input({ follow: follow({ status }) }), NOW),
      ).toBeNull();
    });
  }

  it("存在失败闸门（截止/撤回/待复核等）→ null，不与 Hero 官方出口竞争", () => {
    const result = selectSavedNextAction(
      input({ gates: [gate()], events: [event({ dateIso: "2026-10-13" })] }),
      NOW,
    );
    expect(result).toBeNull();
  });

  it("通过的闸门不拦截", () => {
    const result = selectSavedNextAction(
      input({
        gates: [gate({ passed: true })],
        events: [event({ dateIso: "2026-10-14" })],
      }),
      NOW,
    );
    expect(result?.tier).toBe(2);
  });
});

describe("Tier 1 阻塞条件", () => {
  it("hard FAIL → resolve_blocker，锚定具体条件", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [dimension({ value: "FAIL", requirementId: "req-age" })],
        events: [event({ dateIso: "2026-10-13" })],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 1,
      kind: "resolve_blocker",
      key: "dim:req-age",
      href: "#condition-req-age",
    });
  });

  it("hard FAIL 先于 hard MANUAL_REVIEW，即使 MANUAL_REVIEW 排在数组前面", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [
          dimension({
            value: "MANUAL_REVIEW",
            requirementId: "req-major",
            dimension: "major",
          }),
          dimension({
            value: "FAIL",
            requirementId: "req-age",
            dimension: "age",
          }),
        ],
      }),
      NOW,
    );
    expect(result?.key).toBe("dim:req-age");
    expect(result?.href).toBe("#condition-req-age");
  });

  it("hard MANUAL_REVIEW → 引导到 #to-confirm 官方确认", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [
          dimension({ value: "MANUAL_REVIEW", dimension: "major" }),
        ],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 1,
      kind: "resolve_blocker",
      href: "#to-confirm",
    });
    expect(result?.label).toContain("专业");
  });

  it("非 hard 的 FAIL/MANUAL_REVIEW 不进 Tier 1", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [
          dimension({ value: "FAIL", hard: false, requirementId: "req-x" }),
        ],
        events: [event({ kind: "pending_notice", label: "资格复审", dateIso: null, key: "p0" })],
      }),
      NOW,
    );
    expect(result?.tier).toBe(5);
  });

  it("confirmed_match 个人答复 → 跳过该 MANUAL_REVIEW 阻塞", () => {
    const result = selectSavedNextAction(
      input({
        follow: follow({
          consultationNotes: {
            major: encodeConsultationAnswer({
              outcome: "confirmed_match",
              at: "2026-10-11T00:00:00+08:00",
            }),
          },
        }),
        dimensions: [dimension({ value: "MANUAL_REVIEW", dimension: "major" })],
        events: [event({ dateIso: "2026-10-14" })],
      }),
      NOW,
    );
    expect(result?.tier).toBe(2);
  });

  for (const outcome of ["confirmed_mismatch", "still_unclear", "not_contacted"] as const) {
    it(`${outcome} 答复不跳过阻塞`, () => {
      const result = selectSavedNextAction(
        input({
          follow: follow({
            consultationNotes: {
              major: encodeConsultationAnswer({ outcome, at: "2026-10-11T00:00:00+08:00" }),
            },
          }),
          dimensions: [dimension({ value: "MANUAL_REVIEW", dimension: "major" })],
        }),
        NOW,
      );
      expect(result?.tier).toBe(1);
      expect(result?.href).toBe("#to-confirm");
    });
  }

  it("旧自由文本备注不跳过阻塞", () => {
    const result = selectSavedNextAction(
      input({
        follow: follow({ consultationNotes: { major: "我电话问过，应该行" } }),
        dimensions: [dimension({ value: "MANUAL_REVIEW", dimension: "major" })],
      }),
      NOW,
    );
    expect(result?.tier).toBe(1);
  });
});

describe("Tier 2 72 小时内节点", () => {
  it("72h 内节点优先于缺失信息/材料/更远节点", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [dimension({ value: "UNKNOWN" })],
        materials: [material()],
        events: [
          event({ kind: "written_exam", label: "笔试", dateIso: "2026-10-20", key: "written_exam" }),
          event({ kind: "registration_end", label: "报名截止", dateIso: "2026-10-14", key: "registration_end" }),
        ],
      }),
      NOW,
    );
    expect(result).toMatchObject({ tier: 2, kind: "urgent_node", key: "registration_end" });
    expect(result?.label).toContain("报名截止");
    expect(result?.label).toContain("还剩");
  });

  it("窗口内取最早节点；同时间保持 events 数组顺序", () => {
    const result = selectSavedNextAction(
      input({
        events: [
          event({ kind: "written_exam", label: "笔试", dateIso: "2026-10-14", key: "written_exam" }),
          event({ kind: "payment", label: "缴费截止", dateIso: "2026-10-13", key: "payment" }),
        ],
      }),
      NOW,
    );
    expect(result?.key).toBe("payment");
  });

  it("恰好 72h（含边界）属于 Tier 2", () => {
    const result = selectSavedNextAction(
      input({ events: [event({ dateIso: "2026-10-15", kind: "interview", label: "面试", key: "interview" })] }),
      NOW,
    );
    expect(result?.tier).toBe(2);
  });

  it("距今 0ms（当天零点节点）属于 Tier 2，文案为今天截止", () => {
    const result = selectSavedNextAction(
      input({ events: [event({ dateIso: "2026-10-12" })] }),
      NOW,
    );
    expect(result?.tier).toBe(2);
    expect(result?.label).toContain("今天截止");
  });

  it("已过去节点不进 Tier 2（落到后续层级）", () => {
    const result = selectSavedNextAction(
      input({
        events: [
          event({ kind: "registration_end", label: "报名截止", dateIso: "2026-10-10", key: "registration_end" }),
          event({ kind: "written_exam", label: "笔试", dateIso: "2026-10-20", key: "written_exam" }),
        ],
      }),
      NOW,
    );
    expect(result?.key).toBe("written_exam");
    expect(result?.tier).toBe(4);
  });
});

describe("Tier 3 缺失材料/信息", () => {
  it("hard UNKNOWN 维度先于材料", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [dimension({ value: "UNKNOWN", dimension: "degree", requirementId: "req-degree" })],
        materials: [material()],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 3,
      kind: "supplement_info",
      key: "dim:req-degree",
      href: "#missing-info",
    });
    expect(result?.label).toContain("学位");
  });

  it("非 hard UNKNOWN 不产生 supplement_info", () => {
    const result = selectSavedNextAction(
      input({
        dimensions: [dimension({ value: "UNKNOWN", hard: false })],
        materials: [material()],
      }),
      NOW,
    );
    expect(result?.kind).toBe("prepare_material");
  });

  it("必填材料先于选填材料，按 materials 数组顺序取第一个未完成", () => {
    const result = selectSavedNextAction(
      input({
        materials: [
          material({ id: "mat-optional", label: "推荐信", required: false }),
          material({ id: "mat-done", label: "户口本", required: true }),
          material({ id: "mat-pending", label: "教师资格证", required: true }),
        ],
        follow: follow({
          materialStatuses: { "mat-done": "done" },
        }),
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 3,
      kind: "prepare_material",
      key: "mat:mat-pending",
      href: "#materials",
    });
    // 必填共 2 项、完成 1 项 → （1/2）
    expect(result?.label).toBe("准备材料：教师资格证（1/2）");
  });

  it("done 与 not_applicable 都算完成；全部完成后该层级消失", () => {
    const withStatus = (status: string) =>
      selectSavedNextAction(
        input({
          materials: [material({ id: "mat-1" })],
          follow: follow({ materialStatuses: { "mat-1": status as never } }),
          events: [event({ kind: "pending_notice", label: "面试", dateIso: null, key: "p0" })],
        }),
        NOW,
      );
    expect(withStatus("done")?.tier).toBe(5);
    expect(withStatus("not_applicable")?.tier).toBe(5);
    expect(withStatus("in_progress")?.kind).toBe("prepare_material");
  });

  it("必填材料全部完成后才考虑选填材料（进度按选填组计数）", () => {
    const result = selectSavedNextAction(
      input({
        materials: [
          material({ id: "req-1", label: "身份证", required: true }),
          material({ id: "opt-1", label: "推荐信", required: false }),
          material({ id: "opt-2", label: "获奖证书", required: false }),
        ],
        follow: follow({
          materialStatuses: { "req-1": "done", "opt-1": "done" },
        }),
      }),
      NOW,
    );
    expect(result?.key).toBe("mat:opt-2");
    expect(result?.label).toBe("准备材料：获奖证书（1/2）");
  });
});

describe("Tier 4 / Tier 5", () => {
  it("72h 之外的未来最早节点 → schedule_node，缺省出口 /schedule", () => {
    const result = selectSavedNextAction(
      input({
        events: [
          event({ kind: "written_exam", label: "笔试", dateIso: "2026-11-15", key: "written_exam" }),
          event({ kind: "interview", label: "面试", dateIso: "2026-11-20", key: "interview" }),
        ],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 4,
      kind: "schedule_node",
      key: "written_exam",
      href: "/schedule",
    });
    expect(result?.detail).toContain("11月15日");
  });

  it("仅 null 日期节点 → Tier 5，按固定 kind 优先序", () => {
    const result = selectSavedNextAction(
      input({
        events: [
          event({ kind: "interview", label: "面试", dateIso: null, key: "interview" }),
          event({ kind: "written_exam", label: "笔试", dateIso: null, key: "written_exam" }),
          event({ kind: "registration_end", label: "报名截止", dateIso: null, key: "registration_end" }),
          event({ kind: "registration_start", label: "报名开始", dateIso: null, key: "registration_start" }),
        ],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      tier: 5,
      kind: "await_notice",
      key: "registration_end",
      href: "/schedule",
    });
    expect(result?.label).toBe("报名截止日期未公布：查看日程提醒");
  });

  it("固定优先序之外的 null 节点按 events 数组顺序兜底", () => {
    const result = selectSavedNextAction(
      input({
        events: [
          event({ kind: "pending_notice", label: "体检安排", dateIso: null, key: "p0" }),
          event({ kind: "pending_notice", label: "考察安排", dateIso: null, key: "p1" }),
        ],
      }),
      NOW,
    );
    expect(result?.key).toBe("p0");
    expect(result?.label).toBe("体检安排日期未公布：查看日程提醒");
  });

  it("任何层级都无候选 → null", () => {
    expect(selectSavedNextAction(input(), NOW)).toBeNull();
  });
});

describe("nowIso 推进：机会变化后重算（纯函数）", () => {
  const fixed = input({
    events: [event({ kind: "registration_end", label: "报名截止", dateIso: "2026-10-16", key: "registration_end" })],
  });

  it("4 天前看是 Tier 4，2 天前看是 Tier 2，过期后动作消失", () => {
    expect(selectSavedNextAction(fixed, "2026-10-12T00:00:00")?.tier).toBe(4);
    expect(selectSavedNextAction(fixed, "2026-10-14T00:00:00")?.tier).toBe(2);
    expect(selectSavedNextAction(fixed, "2026-10-17T00:00:00")).toBeNull();
  });

  it("同输入同输出（确定性）", () => {
    const a = selectSavedNextAction(fixed, NOW);
    const b = selectSavedNextAction(fixed, NOW);
    expect(a).toEqual(b);
  });
});

describe("timelineCandidatesFromUnit 适配器", () => {
  function unitWith(over: Partial<UnitMatchDTO> = {}): UnitMatchDTO {
    return {
      unit: {
        id: "unit-1",
        code: "U1",
        name: "岗位",
        region: { code: "330100", province: "浙江省", city: "杭州市" },
        subject: "chinese",
        stage: "middle",
        headcount: 1,
        organizationType: "government_unified",
        employmentNature: { code: "public_institution_staff", officialName: "事业编制" },
        allocation: { code: "direct_school", description: "" },
        ...over.unit,
      },
      announcement: {
        id: "ann-1",
        title: "公告",
        publisher: "教育局",
        organizationType: "government_unified",
        officialUrl: "https://example.gov.cn/a",
        dataset: "demo",
        reviewStatus: "human_reviewed",
        reviewedBy: null,
        reviewedAt: null,
        ...over.announcement,
      },
      version: {
        id: "v1",
        versionNumber: 1,
        sourceKind: "original",
        publishedAt: "2026-09-28T09:00:00+08:00",
        timeline: {},
        officialSource: {
          id: "src",
          locator: { kind: "url", url: "https://example.gov.cn/a" },
          state: "official",
          checkedAt: "2026-10-04T12:00:00+08:00",
        },
        ...over.version,
      },
      gates: [],
      dimensions: [],
      overall: "preliminary_eligible",
      summary: "",
      follow: null,
      ...over,
    } as UnitMatchDTO;
  }

  it("映射 DTO 实际存在的 7 个日期字段，空值不臆造节点", () => {
    const candidates = timelineCandidatesFromUnit(
      unitWith({
        version: {
          id: "v1",
          versionNumber: 1,
          sourceKind: "original",
          publishedAt: "2026-09-28T09:00:00+08:00",
          timeline: {
            registrationStart: "2026-10-03",
            registrationEnd: "2026-10-22",
            paymentDeadline: "2026-10-23",
            admitTicketStart: "2026-11-01",
            writtenExamDate: "2026-11-15",
            scoreDate: "",
            interviewDate: undefined,
          },
          officialSource: {
            id: "src",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "official",
            checkedAt: "2026-10-04T12:00:00+08:00",
          },
        },
      }),
    );
    expect(candidates.map((c) => c.kind)).toEqual([
      "registration_start",
      "registration_end",
      "payment",
      "admit_ticket",
      "written_exam",
    ]);
  });

  it("报名截止节点附官方报名入口（registerUrl 优先于公告链接），标记外链", () => {
    const withRegister = timelineCandidatesFromUnit(
      unitWith({
        unit: { registerUrl: "https://register.example.gov.cn" } as UnitMatchDTO["unit"],
        version: {
          id: "v1",
          versionNumber: 1,
          sourceKind: "original",
          publishedAt: "2026-09-28",
          timeline: { registrationEnd: "2026-10-22" },
          officialSource: {
            id: "src",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "official",
            checkedAt: "2026-10-04",
          },
        },
      }),
    );
    expect(withRegister.find((c) => c.kind === "registration_end")).toMatchObject({
      href: "https://register.example.gov.cn",
      external: true,
    });

    const fallback = timelineCandidatesFromUnit(
      unitWith({
        version: {
          id: "v1",
          versionNumber: 1,
          sourceKind: "original",
          publishedAt: "2026-09-28",
          timeline: { registrationEnd: "2026-10-22" },
          officialSource: {
            id: "src",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "official",
            checkedAt: "2026-10-04",
          },
        },
      }),
    );
    expect(fallback.find((c) => c.kind === "registration_end")?.href).toBe(
      "https://example.gov.cn/a",
    );
  });

  it("pendingItems → dateIso=null 的待通知节点，key 含序号保持稳定", () => {
    const candidates = timelineCandidatesFromUnit(
      unitWith({
        version: {
          id: "v1",
          versionNumber: 1,
          sourceKind: "original",
          publishedAt: "2026-09-28",
          timeline: { pendingItems: ["资格复审安排", "体检安排"] },
          officialSource: {
            id: "src",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "official",
            checkedAt: "2026-10-04",
          },
        },
      }),
    );
    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "pending_notice",
        label: "资格复审安排",
        dateIso: null,
        key: "pending_notice:0",
      }),
      expect.objectContaining({
        kind: "pending_notice",
        label: "体检安排",
        dateIso: null,
        key: "pending_notice:1",
      }),
    ]);
  });
});
