/**
 * 机会测试样本（工作包 0）：覆盖 PRD 7.5 状态模型的全部展示分类。
 *
 * 分类预期（以 REFERENCE_NOW 为参考时间，配合 samples/profiles.ts）：
 * - PRIORITY_OPPORTUNITY          → 闸门全过 + 全部 PASS          → 优先机会
 * - NEED_INFO_OPPORTUNITY         → 闸门全过 + 户籍/年龄 UNKNOWN   → 补充后判断（补全事实可重算为优先）
 * - OUT_OF_PREFERENCE_OPPORTUNITY → 闸门全过 + 仅地区 FAIL         → 偏好范围外（不是资格不符合）
 * - MANUAL_REVIEW_OPPORTUNITY     → 闸门全过 + 专业目录歧义         → 建议官方确认
 * - FAIL_OPPORTUNITY              → 闸门全过 + 学历硬性 FAIL        → 明确不符合（非优先结果）
 * - CLOSED_OPPORTUNITY            → 报名已截止闸门失败              → 不进入正常机会
 *
 * 所有样本为虚构测试数据：单位名带「测试」前缀，URL 使用 example.gov.cn 占位域，
 * 证据状态按样本目的构造（priority 等使用 official；closed 样本同样 official 以隔离变量）。
 * 不得被 src/ 或 backend/src/ 生产代码引用（isolation.test.ts 守护）。
 */
import type {
  AnnouncementVersion,
  ApplicationUnit,
  EvidenceAnchor,
  RecruitmentAnnouncement,
  Requirement,
} from "@/lib/announcements/types";

/** 全部样本共用的固定参考时间（保证测试确定性，与真实日期无关） */
export const REFERENCE_NOW = "2026-10-13T08:00:00.000Z";

/** 报名中的统一截止（参考时间之后） */
const OPEN_DEADLINE = "2026-11-30";
/** 已截止样本的截止日（参考时间之前） */
const PAST_DEADLINE = "2026-09-30";

let evidenceSeq = 0;
function makeEvidence(excerpt: string, idSuffix: string): EvidenceAnchor {
  evidenceSeq += 1;
  return {
    id: `fx-evidence-${idSuffix}-${evidenceSeq}`,
    locator: {
      kind: "url",
      url: "https://www.example.gov.cn/test/notice",
      anchor: `测试锚点-${idSuffix}`,
    },
    excerpt,
    state: "official",
    checkedAt: "2026-10-10T00:00:00.000Z",
  };
}

function req(
  id: string,
  dimension: Requirement["dimension"],
  description: string,
  criterion: Requirement["criterion"],
  annId: string,
): Requirement {
  return {
    id,
    dimension,
    description,
    hard: true,
    criterion,
    evidence: makeEvidence(description, annId),
  };
}

interface SampleOverrides {
  id: string;
  title: string;
  unitId: string;
  unitName: string;
  regionCode: string;
  district?: string;
  registrationEnd?: string;
  requirements: Requirement[];
}

/** 构造闸门全过的单单元公告（除样本特意覆盖的字段外） */
function makeSampleAnnouncement(overrides: SampleOverrides): RecruitmentAnnouncement {
  const versionId = `${overrides.id}-v1`;
  const unit: ApplicationUnit = {
    id: overrides.unitId,
    code: "FX-01",
    name: overrides.unitName,
    announcementId: overrides.id,
    versionId,
    region: {
      code: overrides.regionCode,
      province: overrides.regionCode.startsWith("33") ? "浙江省" : "江苏省",
      city: overrides.regionCode.startsWith("3301")
        ? "杭州市"
        : overrides.regionCode.startsWith("3205")
          ? "苏州市"
          : "测试市",
      district: overrides.district,
    },
    subject: "chinese",
    stage: "middle",
    headcount: 1,
    organizationType: "government_unified",
    employmentNature: { code: "public_institution_staff", officialName: "事业编制（测试）" },
    allocation: { code: "unified_assignment", description: "测试分配方式" },
    requirements: overrides.requirements,
  };
  const version: AnnouncementVersion = {
    id: versionId,
    announcementId: overrides.id,
    versionNumber: 1,
    sourceKind: "original",
    publishedAt: "2026-10-01T00:00:00.000Z",
    officialSource: makeEvidence("测试公告官方来源", overrides.id),
    timeline: {
      registrationStart: "2026-10-01",
      registrationEnd: overrides.registrationEnd ?? OPEN_DEADLINE,
    },
    units: [unit],
  };
  return {
    id: overrides.id,
    title: overrides.title,
    publisher: "测试市教育局",
    organizationType: "government_unified",
    officialUrl: "https://www.example.gov.cn/test/notice",
    subjectScope: ["chinese"],
    region: unit.region,
    lifecycle: "active",
    firstPublishedAt: "2026-10-01T00:00:00.000Z",
    versions: [version],
  };
}

/** 1. 优先机会：杭州初中语文，条件与 COMPLETE_PROFILE 全部匹配 */
export const PRIORITY_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-priority",
  title: "【测试】优先机会公告",
  unitId: "fx-unit-priority",
  unitName: "测试市第一中学（初中语文）",
  regionCode: "330102",
  district: "测试区",
  requirements: [
    req("fx-priority-edu", "education", "本科及以上学历", { kind: "education", minLevel: "bachelor" }, "priority"),
    req("fx-priority-major", "major", "汉语言文学（师范）", { kind: "major", majorNames: ["汉语言文学（师范）"] }, "priority"),
    req("fx-priority-cert", "teacher_cert", "初中语文教师资格证", { kind: "teacher_cert", subject: "chinese", stage: "middle", acceptInProgress: false }, "priority"),
    req("fx-priority-age", "age", "35 周岁及以下", { kind: "age", maxAgeYears: 35 }, "priority"),
  ],
});

/** 2. 缺事实可重算机会：户籍+年龄要求；缺事实画像得 UNKNOWN，补全后全部 PASS */
export const NEED_INFO_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-need-info",
  title: "【测试】补充后判断公告",
  unitId: "fx-unit-need-info",
  unitName: "测试市第二中学（初中语文）",
  regionCode: "330103",
  district: "测试区",
  requirements: [
    req("fx-needinfo-edu", "education", "本科及以上学历", { kind: "education", minLevel: "bachelor" }, "needinfo"),
    req("fx-needinfo-hukou", "hukou", "限杭州市户籍", { kind: "hukou", allowedRegionCodes: ["330100"], label: "杭州市户籍" }, "needinfo"),
    req("fx-needinfo-age", "age", "35 周岁及以下", { kind: "age", maxAgeYears: 35 }, "needinfo"),
  ],
});

/** 3. 资格通过但超出偏好：苏州岗位 vs 仅接受浙江的画像（仅地区维度 FAIL） */
export const OUT_OF_PREFERENCE_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-out-of-preference",
  title: "【测试】偏好范围外公告",
  unitId: "fx-unit-out-of-preference",
  unitName: "测试外国语学校（初中语文）",
  regionCode: "320500",
  requirements: [
    req("fx-pref-edu", "education", "本科及以上学历", { kind: "education", minLevel: "bachelor" }, "pref"),
    req("fx-pref-cert", "teacher_cert", "初中语文教师资格证", { kind: "teacher_cert", subject: "chinese", stage: "middle", acceptInProgress: false }, "pref"),
  ],
});

/** 4. MANUAL_REVIEW：专业目录表述有解释空间且精确匹配不中 → 建议官方确认 */
export const MANUAL_REVIEW_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-manual-review",
  title: "【测试】建议官方确认公告",
  unitId: "fx-unit-manual-review",
  unitName: "测试市第三中学（初中语文）",
  regionCode: "330104",
  district: "测试区",
  requirements: [
    req("fx-manual-edu", "education", "本科及以上学历", { kind: "education", minLevel: "bachelor" }, "manual"),
    req(
      "fx-manual-major",
      "major",
      "汉语言文学或相关专业",
      { kind: "major", majorNames: ["汉语言文学"], catalogGroups: ["中国语言文学类"], ambiguous: true },
      "manual",
    ),
  ],
});

/** 5. 明确 FAIL：要求硕士，画像为本科（硬性 FAIL，非优先结果） */
export const FAIL_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-fail",
  title: "【测试】明确不符合公告",
  unitId: "fx-unit-fail",
  unitName: "测试市高级中学（高中语文）",
  regionCode: "330105",
  district: "测试区",
  requirements: [
    req("fx-fail-edu", "education", "硕士研究生及以上学历", { kind: "education", minLevel: "master" }, "fail"),
  ],
});

/** 6. 已截止机会：报名截止早于参考时间 → registration_closed 闸门失败，不进正常机会 */
export const CLOSED_OPPORTUNITY = makeSampleAnnouncement({
  id: "fx-ann-closed",
  title: "【测试】已截止公告",
  unitId: "fx-unit-closed",
  unitName: "测试市第四中学（初中语文）",
  regionCode: "330106",
  district: "测试区",
  registrationEnd: PAST_DEADLINE,
  requirements: [
    req("fx-closed-edu", "education", "本科及以上学历", { kind: "education", minLevel: "bachelor" }, "closed"),
  ],
});

/** 6b. 来源失效变体：人工巡检确认官方发布页 404 → source_unavailable 闸门失败 */
export const SOURCE_UNAVAILABLE_OPPORTUNITY: RecruitmentAnnouncement = {
  ...CLOSED_OPPORTUNITY,
  id: "fx-ann-source-down",
  title: "【测试】来源失效公告",
  officialUrl: "https://www.example.gov.cn/test/removed",
  versions: [
    {
      ...CLOSED_OPPORTUNITY.versions[0]!,
      id: "fx-ann-source-down-v1",
      announcementId: "fx-ann-source-down",
      timeline: { registrationStart: "2026-10-01", registrationEnd: OPEN_DEADLINE },
      units: [
        {
          ...CLOSED_OPPORTUNITY.versions[0]!.units[0]!,
          id: "fx-unit-source-down",
          announcementId: "fx-ann-source-down",
          versionId: "fx-ann-source-down-v1",
        },
      ],
    },
  ],
  sourceHealth: {
    ok: false,
    checkedAt: "2026-10-12T00:00:00.000Z",
    failReason: "官方发布页返回 404（测试构造）",
  },
};

/** 全部机会样本（测试批量消费用） */
export const ALL_OPPORTUNITY_SAMPLES: RecruitmentAnnouncement[] = [
  PRIORITY_OPPORTUNITY,
  NEED_INFO_OPPORTUNITY,
  OUT_OF_PREFERENCE_OPPORTUNITY,
  MANUAL_REVIEW_OPPORTUNITY,
  FAIL_OPPORTUNITY,
  CLOSED_OPPORTUNITY,
  SOURCE_UNAVAILABLE_OPPORTUNITY,
];
