import { describe, expect, it } from "vitest";
import type {
  AnnouncementVersion,
  ApplicationUnit,
  RecruitmentAnnouncement,
} from "@/lib/announcements/types";
import {
  availableBatchYears,
  availableHistoryFilters,
  batchYearOf,
  chinaToday,
  collectHistoricalUnits,
  completenessOf,
  filterHistoricalUnits,
  historySampleNote,
  isHistoricalAnnouncement,
  paginate,
} from "./domain";

const NOW = new Date("2026-10-28T12:00:00+08:00");

function makeVersion(overrides: Partial<AnnouncementVersion["timeline"]> = {}): AnnouncementVersion {
  return {
    id: "a-v1",
    announcementId: "a",
    versionNumber: 1,
    sourceKind: "original",
    publishedAt: "2025-03-01T10:00:00+08:00",
    officialSource: {
      id: "src",
      locator: { kind: "url", url: "https://example.gov.cn/a" },
      state: "official",
      checkedAt: "2025-03-01T10:00:00+08:00",
    },
    timeline: {
      registrationStart: "2025-03-10",
      registrationEnd: "2025-03-20",
      ...overrides,
    },
    units: [],
  };
}

function makeUnit(id: string, overrides: Partial<ApplicationUnit> = {}): ApplicationUnit {
  return {
    id,
    code: id,
    name: `单元${id}`,
    announcementId: "a",
    versionId: "a-v1",
    region: { code: "330100", province: "浙江省", city: "杭州市" },
    subject: "chinese",
    stage: "high",
    headcount: 1,
    organizationType: "government_unified",
    employmentNature: { code: "public_institution_staff", officialName: "事业编制" },
    allocation: { code: "direct_school", description: "直接定岗" },
    requirements: [],
    ...overrides,
  };
}

function makeAnnouncement(
  id: string,
  timeline: Partial<AnnouncementVersion["timeline"]>,
  overrides: Partial<RecruitmentAnnouncement> = {},
  units: ApplicationUnit[] = [makeUnit(`${id}-u1`)],
): RecruitmentAnnouncement {
  const version = { ...makeVersion(timeline), id: `${id}-v1`, announcementId: id, units };
  return {
    id,
    title: `公告${id}`,
    publisher: "某教育局",
    organizationType: "government_unified",
    officialUrl: "https://example.gov.cn/a",
    subjectScope: ["chinese"],
    region: { code: "330100", province: "浙江省", city: "杭州市" },
    lifecycle: "active",
    firstPublishedAt: "2025-03-01T10:00:00+08:00",
    versions: [version],
    ...overrides,
  };
}

describe("chinaToday", () => {
  it("按 Asia/Shanghai 输出日历日", () => {
    expect(chinaToday(NOW)).toBe("2026-10-28");
  });
});

describe("isHistoricalAnnouncement", () => {
  it("报名截止早于今日 → 历史", () => {
    const a = makeAnnouncement("a", {
      registrationStart: "2026-05-06",
      registrationEnd: "2026-05-11",
    });
    expect(isHistoricalAnnouncement(a, NOW)).toBe(true);
  });

  it("报名截止就是今天 → 仍在当前入口，不算历史", () => {
    const a = makeAnnouncement("a", {
      registrationStart: "2026-10-20",
      registrationEnd: "2026-10-28",
    });
    expect(isHistoricalAnnouncement(a, NOW)).toBe(false);
  });

  it("跨年但报名仍有效 → 留在当前入口（不能靠标题年份归类）", () => {
    const a = makeAnnouncement(
      "a",
      { registrationStart: "2026-12-01", registrationEnd: "2027-01-15" },
      { firstPublishedAt: "2026-11-01T10:00:00+08:00" },
    );
    expect(isHistoricalAnnouncement(a, NOW)).toBe(false);
  });

  it("报名日期未定（预告）→ 不算历史", () => {
    const a = makeAnnouncement("a", {
      registrationStart: undefined,
      registrationEnd: undefined,
    });
    expect(isHistoricalAnnouncement(a, NOW)).toBe(false);
  });

  it("lifecycle=withdrawn → 历史（即使无截止日）", () => {
    const a = makeAnnouncement(
      "a",
      { registrationStart: undefined, registrationEnd: undefined },
      { lifecycle: "withdrawn" },
    );
    expect(isHistoricalAnnouncement(a, NOW)).toBe(true);
  });
});

describe("batchYearOf", () => {
  it("批次年取报名开始年", () => {
    const a = makeAnnouncement("a", {
      registrationStart: "2025-03-10",
      registrationEnd: "2025-03-20",
    });
    expect(batchYearOf(a, a.versions[0]!)).toBe(2025);
  });

  it("缺报名开始日期回退公告发布年", () => {
    const a = makeAnnouncement(
      "a",
      { registrationStart: undefined, registrationEnd: undefined },
      { firstPublishedAt: "2024-06-01T09:00:00+08:00", lifecycle: "withdrawn" },
    );
    expect(batchYearOf(a, a.versions[0]!)).toBe(2024);
  });
});

describe("collectHistoricalUnits", () => {
  it("只收历史公告的单元，按报名截止日倒序", () => {
    const ended2025 = makeAnnouncement("h2025", {
      registrationStart: "2025-03-10",
      registrationEnd: "2025-03-20",
    });
    const ended2026 = makeAnnouncement("h2026", {
      registrationStart: "2026-05-06",
      registrationEnd: "2026-05-11",
    });
    const open = makeAnnouncement("cur", {
      registrationStart: "2026-10-20",
      registrationEnd: "2026-11-05",
    });
    const records = collectHistoricalUnits([ended2025, ended2026, open], NOW);
    expect(records.map((r) => r.unit.id)).toEqual(["h2026-u1", "h2025-u1"]);
  });
});

describe("filterHistoricalUnits", () => {
  const records = collectHistoricalUnits(
    [
      makeAnnouncement(
        "a",
        { registrationStart: "2025-03-10", registrationEnd: "2025-03-20" },
        { title: "杭州高中语文公告" },
        [
          makeUnit("a-u1", {
            name: "杭州高中语文教师",
            stage: "high",
            employmentNature: { code: "public_institution_staff", officialName: "事业编" },
            region: { code: "330100", province: "浙江省", city: "杭州市" },
          }),
        ],
      ),
      makeAnnouncement(
        "b",
        { registrationStart: "2024-04-08", registrationEnd: "2024-04-15" },
        { title: "南京小学语文公告" },
        [
          makeUnit("b-u1", {
            name: "南京小学语文教师",
            stage: "primary",
            employmentNature: { code: "record_filing", officialName: "备案制" },
            region: { code: "320100", province: "江苏省", city: "南京市" },
          }),
        ],
      ),
    ],
    NOW,
  );

  it("按批次年筛选", () => {
    expect(filterHistoricalUnits(records, { year: 2024 }).map((r) => r.unit.id)).toEqual(["b-u1"]);
  });

  it("按地区代码前缀筛选", () => {
    expect(filterHistoricalUnits(records, { regionCode: "33" }).map((r) => r.unit.id)).toEqual(["a-u1"]);
  });

  it("按学段与用工性质筛选", () => {
    expect(filterHistoricalUnits(records, { stage: "primary" }).map((r) => r.unit.id)).toEqual(["b-u1"]);
    expect(filterHistoricalUnits(records, { nature: "record_filing" }).map((r) => r.unit.id)).toEqual(["b-u1"]);
  });

  it("按关键词筛选（单位名/公告标题/发布主体）", () => {
    expect(filterHistoricalUnits(records, { keyword: "南京" }).map((r) => r.unit.id)).toEqual(["b-u1"]);
    expect(filterHistoricalUnits(records, { keyword: "不存在" })).toEqual([]);
  });

  it("组合筛选", () => {
    expect(
      filterHistoricalUnits(records, { year: 2025, stage: "high", keyword: "杭州" }).map((r) => r.unit.id),
    ).toEqual(["a-u1"]);
  });

  it("按岗位最低学历与专业范围筛选（R06）", () => {
    const withRequirements = collectHistoricalUnits(
      [
        makeAnnouncement(
          "c",
          { registrationStart: "2025-03-10", registrationEnd: "2025-03-20" },
          { title: "硕士语文岗位" },
          [
            makeUnit("c-u1", {
              name: "硕士语文教师",
              requirements: [
                {
                  id: "c-u1-edu",
                  dimension: "education",
                  description: "硕士研究生及以上",
                  hard: true,
                  criterion: { kind: "education", minLevel: "master" },
                  evidence: {
                    id: "c-u1-edu-ev",
                    locator: { kind: "excerpt", excerpt: "硕士研究生及以上" },
                    state: "official",
                    checkedAt: "2025-03-01T10:00:00+08:00",
                  },
                },
                {
                  id: "c-u1-major",
                  dimension: "major",
                  description: "汉语言文学及相关专业",
                  hard: true,
                  criterion: {
                    kind: "major",
                    majorNames: ["汉语言文学", "学科教学（语文）"],
                  },
                  evidence: {
                    id: "c-u1-major-ev",
                    locator: { kind: "excerpt", excerpt: "汉语言文学及相关专业" },
                    state: "official",
                    checkedAt: "2025-03-01T10:00:00+08:00",
                  },
                },
              ],
            }),
          ],
        ),
      ],
      NOW,
    );

    // 学历精确匹配岗位最低学历，不把“本科可报的硕士岗”混入本科筛选
    expect(
      filterHistoricalUnits(withRequirements, { educationLevel: "master" }).map(
        (r) => r.unit.id,
      ),
    ).toEqual(["c-u1"]);
    expect(
      filterHistoricalUnits(withRequirements, { educationLevel: "bachelor" }),
    ).toEqual([]);

    // 专业按公告列明范围匹配，全半角/空白差异不误伤
    expect(
      filterHistoricalUnits(withRequirements, { major: "汉语言文学" }).map(
        (r) => r.unit.id,
      ),
    ).toEqual(["c-u1"]);
    expect(
      filterHistoricalUnits(withRequirements, { major: "学科教学(语文)" }).map(
        (r) => r.unit.id,
      ),
    ).toEqual(["c-u1"]);
    expect(filterHistoricalUnits(withRequirements, { major: "数学与应用数学" })).toEqual(
      [],
    );

    // 选项只来自真实数据，不预置空项
    const options = availableHistoryFilters(withRequirements);
    expect(options.educationLevels).toEqual([{ code: "master", label: "硕士" }]);
    expect(options.majors).toEqual(["汉语言文学", "学科教学（语文）"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("首页与末页", () => {
    expect(paginate(items, 1, 20).items).toHaveLength(20);
    const last = paginate(items, 2, 20);
    expect(last.items).toEqual([21, 22, 23, 24, 25]);
    expect(last.total).toBe(25);
  });

  it("页码越界回退最后一页；pageSize 上限 50", () => {
    expect(paginate(items, 99, 20).page).toBe(2);
    expect(paginate(items, 1, 500).pageSize).toBe(50);
  });

  it("空集", () => {
    const page = paginate([], 1, 20);
    expect(page).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });
});

describe("completenessOf", () => {
  it("统计已知日期、材料数与证据审核状态", () => {
    const version = makeVersion({
      registrationStart: "2025-03-10",
      registrationEnd: "2025-03-20",
      writtenExamDate: "2025-03-29",
      // interviewDate 缺失
    });
    const unit = makeUnit("u1", {
      requirements: [
        {
          id: "r1",
          dimension: "education",
          description: "本科及以上",
          hard: true,
          criterion: { kind: "education", minLevel: "bachelor" },
          evidence: {
            id: "e1",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "ai_extracted",
            checkedAt: "2025-03-01T10:00:00+08:00",
          },
        },
      ],
      materials: [
        {
          id: "m1",
          label: "身份证",
          applicableAudience: "所有报考者",
          required: true,
          source: {
            id: "e2",
            locator: { kind: "url", url: "https://example.gov.cn/a" },
            state: "official",
            checkedAt: "2025-03-01T10:00:00+08:00",
          },
        },
      ],
    });
    const result = completenessOf(version, unit);
    expect(result.knownDateCount).toBe(3);
    expect(result.totalDateCount).toBe(4);
    expect(result.materialCount).toBe(1);
    // 含 AI 初核证据 → 如实标注
    expect(result.evidenceState).toBe("ai_extracted");
  });
});

describe("availableBatchYears / historySampleNote", () => {
  it("年份去重倒序；样本说明不推测本年", () => {
    const records = collectHistoricalUnits(
      [
        makeAnnouncement("a", { registrationStart: "2025-03-10", registrationEnd: "2025-03-20" }),
        makeAnnouncement("b", { registrationStart: "2024-04-08", registrationEnd: "2024-04-15" }),
        makeAnnouncement("c", { registrationStart: "2024-09-01", registrationEnd: "2024-09-10" }),
      ],
      NOW,
    );
    expect(availableBatchYears(records)).toEqual([2025, 2024]);
    const note = historySampleNote([2025, 2024], 3);
    expect(note).toContain("2024—2025");
    expect(note).toContain("不代表当地没有招聘");
    expect(note).not.toContain("本年必招");
  });

  it("无数据时的真实空口径", () => {
    expect(historySampleNote([], 0)).toContain("没有已收录的往年公告");
  });
});
