/**
 * 往年参考演示数据（D06 / PRD 11.7 U06）。
 *
 * 与 v61-opportunities.ts 的滚动时间轴严格区分：
 * - 本文件日期固定（2024/2025 年真实日历日），绝不随当前日期滚动，
 *   保证往年参考的筛选、批次年与报名有效期稳定可验；
 * - 全部为虚构示例（example.gov.cn 占位链接），仅用于演示往年参考的浏览与对照体验；
 * - 其中 2025 苏州示例的官方来源登记为失效（404），用于演示「官方链接失效仍显示存档状态」。
 */
import type {
  AllocationMethod,
  AnnouncementTimeline,
  AnnouncementVersion,
  ApplicationUnit,
  EmploymentNature,
  EvidenceAnchor,
  EvidenceLocator,
  MaterialItem,
  RecruitmentAnnouncement,
  RegionRef,
  Requirement,
  RequirementCriterion,
  RequirementDimension,
  SchoolPlacement,
  StageCode,
} from "@/lib/announcements/types";

const HISTORY_CHECKED_AT = "2026-10-04T12:00:00+08:00";

function officialAnchor(id: string, url: string, excerpt: string): EvidenceAnchor {
  const locator: EvidenceLocator = { kind: "url", url };
  return { id, locator, excerpt, state: "official", checkedAt: HISTORY_CHECKED_AT };
}

function requirement(
  id: string,
  dimension: RequirementDimension,
  description: string,
  criterion: RequirementCriterion,
  evidenceUrl: string,
  excerpt: string,
): Requirement {
  return {
    id,
    dimension,
    description,
    hard: true,
    criterion,
    evidence: officialAnchor(`${id}-ev`, evidenceUrl, excerpt),
  };
}

const NATURE_PUBLIC: EmploymentNature = {
  code: "public_institution_staff",
  officialName: "事业编制工作人员",
};
const NATURE_RECORD: EmploymentNature = {
  code: "record_filing",
  officialName: "事业编制备案管理（备案制）",
};
const NATURE_QUOTA: EmploymentNature = {
  code: "post_quota",
  officialName: "员额池管理（员额制）",
};

const ALLOC_DIRECT: AllocationMethod = {
  code: "direct_school",
  description: "按报考学校直接定岗",
};
const ALLOC_ASSIGN: AllocationMethod = {
  code: "unified_assignment",
  description: "录取后由教育局统一调配至辖区学校",
};

interface HistoryUnitSpec {
  id: string;
  code: string;
  name: string;
  region: RegionRef;
  stage: StageCode;
  headcount: number;
  nature: EmploymentNature;
  allocation: AllocationMethod;
  teachingScope?: string;
  schoolPlacement?: SchoolPlacement;
  requirements: Requirement[];
  materials?: MaterialItem[];
}

function historyUnit(announcementId: string, spec: HistoryUnitSpec): ApplicationUnit {
  return {
    id: spec.id,
    code: spec.code,
    name: spec.name,
    announcementId,
    versionId: `${announcementId}-v1`,
    region: spec.region,
    teachingScope: spec.teachingScope,
    schoolPlacement: spec.schoolPlacement,
    subject: "chinese",
    stage: spec.stage,
    headcount: spec.headcount,
    organizationType: "government_unified",
    employmentNature: spec.nature,
    allocation: spec.allocation,
    requirements: spec.requirements,
    materials: spec.materials,
  };
}

function historyMaterials(officialUrl: string): MaterialItem[] {
  return [
    {
      id: "id-card",
      label: "身份证",
      applicableAudience: "以公告为准",
      required: false,
      source: officialAnchor(
        "demo-history-mat-id",
        officialUrl,
        "报名一般需提供有效身份证件，具体以公告为准。",
      ),
    },
    {
      id: "edu-cert",
      label: "学历、学位证书",
      applicableAudience: "以公告为准",
      required: false,
      source: officialAnchor(
        "demo-history-mat-edu",
        officialUrl,
        "须提供学历证书、学位证书，具体以公告为准。",
      ),
    },
  ];
}

function v1(
  announcementId: string,
  publishedAt: string,
  sourceUrl: string,
  excerpt: string,
  timeline: AnnouncementTimeline,
  units: ApplicationUnit[],
): AnnouncementVersion {
  return {
    id: `${announcementId}-v1`,
    announcementId,
    versionNumber: 1,
    sourceKind: "original",
    publishedAt,
    officialSource: officialAnchor(
      `${announcementId}-v1-src`,
      sourceUrl,
      "公告官方发布页",
    ),
    timeline,
    units,
  };
}

function chineseMajorRequirement(id: string, url: string, excerpt: string): Requirement {
  return requirement(
    id,
    "major",
    "中国语言文学类（含汉语言文学等相关专业，以当年公告岗位表为准）",
    {
      kind: "major",
      majorNames: ["中国语言文学类", "汉语言文学", "汉语言文学（师范）"],
      catalogGroups: ["中国语言文学类"],
    },
    url,
    excerpt,
  );
}

// ---------- 2025 杭州市直属（高中语文，日期完整） ----------

function hangzhou2025(): RecruitmentAnnouncement {
  const id = "demo-history-hz-2025";
  const url = "https://example.gov.cn/demo/history/hz-2025";
  const requirements: Requirement[] = [
    requirement(
      "demo-history-hz25-edu",
      "education",
      "本科及以上学历（示例公告原文）",
      { kind: "education", minLevel: "bachelor" },
      url,
      "示例：具有国家承认的本科及以上学历。",
    ),
    chineseMajorRequirement(
      "demo-history-hz25-major",
      url,
      "示例：中国语言文学类（含汉语言文学）。",
    ),
    requirement(
      "demo-history-hz25-cert",
      "teacher_cert",
      "高级中学语文教师资格（示例公告原文）",
      {
        kind: "teacher_cert",
        subject: "chinese",
        stage: "high",
        acceptInProgress: true,
      },
      url,
      "示例：须具备高级中学语文教师资格证或合格证明。",
    ),
    requirement(
      "demo-history-hz25-age",
      "age",
      "35 周岁以下（示例公告原文）",
      { kind: "age", maxAgeYears: 35, referenceDate: "2025-04-01" },
      url,
      "示例：1989 年 4 月 1 日以后出生。",
    ),
  ];
  return {
    id,
    title: "2025年杭州市教育局直属学校公开招聘教师公告（示例）",
    publisher: "杭州市教育局（示例）",
    organizationType: "government_unified",
    officialUrl: url,
    subjectScope: ["chinese"],
    region: { code: "330100", province: "浙江省", city: "杭州市" },
    lifecycle: "active",
    firstPublishedAt: "2025-03-28T10:00:00+08:00",
    versions: [
      v1(
        id,
        "2025-03-28T10:00:00+08:00",
        url,
        "示例：杭州市教育局直属学校2025年春季公开招聘教师，高中语文教师3名。",
        {
          registrationStart: "2025-04-14",
          registrationEnd: "2025-04-20",
          writtenExamDate: "2025-05-10",
          interviewDate: "2025-05-24",
        },
        [
          historyUnit(id, {
            id: "demo-history-hz25-high-chinese-01",
            code: "HZ2025-示例01",
            name: "杭州示例第一中学·高中语文教师（2025年批次）",
            region: { code: "330102", province: "浙江省", city: "杭州市", district: "上城区" },
            stage: "high",
            headcount: 3,
            nature: NATURE_PUBLIC,
            allocation: ALLOC_DIRECT,
            teachingScope: "杭州示例第一中学",
            schoolPlacement: { status: "specified", schoolName: "杭州示例第一中学" },
            requirements,
            materials: historyMaterials(url),
          }),
        ],
      ),
    ],
    sourceHealth: { ok: true, checkedAt: HISTORY_CHECKED_AT, failReason: null },
  };
}

// ---------- 2025 苏州高新区（初中语文，面试待定 + 官方来源失效存档） ----------

function suzhou2025(): RecruitmentAnnouncement {
  const id = "demo-history-sz-2025";
  const url = "https://example.gov.cn/demo/history/sz-2025";
  const requirements: Requirement[] = [
    requirement(
      "demo-history-sz25-edu",
      "education",
      "本科及以上学历（示例公告原文）",
      { kind: "education", minLevel: "bachelor" },
      url,
      "示例：本科及以上学历，并取得相应学位。",
    ),
    chineseMajorRequirement(
      "demo-history-sz25-major",
      url,
      "示例：中国语言文学类。",
    ),
    requirement(
      "demo-history-sz25-cert",
      "teacher_cert",
      "初级中学及以上语文教师资格（示例公告原文）",
      {
        kind: "teacher_cert",
        subject: "chinese",
        stage: "middle",
        acceptInProgress: true,
        acceptHigherStage: true,
      },
      url,
      "示例：须具备初级中学及以上语文学科教师资格。",
    ),
  ];
  return {
    id,
    title: "2025年苏州高新区教育系统公开招聘教师公告（示例）",
    publisher: "苏州高新区教育局（示例）",
    organizationType: "government_unified",
    officialUrl: url,
    subjectScope: ["chinese"],
    region: { code: "320500", province: "江苏省", city: "苏州市" },
    lifecycle: "active",
    firstPublishedAt: "2025-02-20T09:00:00+08:00",
    versions: [
      v1(
        id,
        "2025-02-20T09:00:00+08:00",
        url,
        "示例：苏州高新区公开招聘初中语文教师5名，录取后统一调配。",
        {
          registrationStart: "2025-03-03",
          registrationEnd: "2025-03-14",
          writtenExamDate: "2025-03-29",
          pendingItems: ["面试具体时间由招聘学校另行通知（示例）"],
        },
        [
          historyUnit(id, {
            id: "demo-history-sz25-middle-chinese-01",
            code: "SZ2025-示例01",
            name: "苏州高新区示例初中岗位组·初中语文教师（2025年批次）",
            region: { code: "320505", province: "江苏省", city: "苏州市", district: "虎丘区" },
            stage: "middle",
            headcount: 5,
            nature: NATURE_RECORD,
            allocation: ALLOC_ASSIGN,
            teachingScope: "苏州高新区教育局下属初中，统一调配",
            schoolPlacement: {
              status: "unspecified",
              note: "示例：岗位组统一招聘，录取后由教育局统一调配至辖区学校",
            },
            requirements,
            materials: historyMaterials(url),
          }),
        ],
      ),
    ],
    // 官方链接失效：历史留档保留，展示存档状态
    sourceHealth: {
      ok: false,
      checkedAt: HISTORY_CHECKED_AT,
      failReason: "官方发布页返回 404（示例：用于演示链接失效时的存档展示）",
    },
  };
}

// ---------- 2024 南京市直属（小学语文，无面试日期） ----------

function nanjing2024(): RecruitmentAnnouncement {
  const id = "demo-history-nj-2024";
  const url = "https://example.gov.cn/demo/history/nj-2024";
  const requirements: Requirement[] = [
    requirement(
      "demo-history-nj24-edu",
      "education",
      "本科及以上学历（示例公告原文）",
      { kind: "education", minLevel: "bachelor" },
      url,
      "示例：本科及以上学历。",
    ),
    chineseMajorRequirement(
      "demo-history-nj24-major",
      url,
      "示例：中国语言文学类。",
    ),
    requirement(
      "demo-history-nj24-cert",
      "teacher_cert",
      "小学及以上语文教师资格（示例公告原文）",
      {
        kind: "teacher_cert",
        subject: "chinese",
        stage: "primary",
        acceptInProgress: false,
        acceptHigherStage: true,
      },
      url,
      "示例：须已取得小学及以上语文学科教师资格证。",
    ),
  ];
  return {
    id,
    title: "2024年南京市直属学校公开招聘教师公告（示例）",
    publisher: "南京市教育局（示例）",
    organizationType: "government_unified",
    officialUrl: url,
    subjectScope: ["chinese"],
    region: { code: "320100", province: "江苏省", city: "南京市" },
    lifecycle: "active",
    firstPublishedAt: "2024-03-15T14:00:00+08:00",
    versions: [
      v1(
        id,
        "2024-03-15T14:00:00+08:00",
        url,
        "示例：南京市直属学校公开招聘小学语文教师2名。",
        {
          registrationStart: "2024-04-08",
          registrationEnd: "2024-04-15",
          writtenExamDate: "2024-04-27",
        },
        [
          historyUnit(id, {
            id: "demo-history-nj24-primary-chinese-01",
            code: "NJ2024-示例01",
            name: "南京示例小学·小学语文教师（2024年批次）",
            region: { code: "320102", province: "江苏省", city: "南京市", district: "玄武区" },
            stage: "primary",
            headcount: 2,
            nature: NATURE_PUBLIC,
            allocation: ALLOC_DIRECT,
            teachingScope: "南京示例小学",
            schoolPlacement: { status: "specified", schoolName: "南京示例小学" },
            requirements,
            materials: historyMaterials(url),
          }),
        ],
      ),
    ],
    sourceHealth: { ok: true, checkedAt: HISTORY_CHECKED_AT, failReason: null },
  };
}

// ---------- 2024 宁波鄞州（初中语文，员额制） ----------

function yinzhou2024(): RecruitmentAnnouncement {
  const id = "demo-history-yz-2024";
  const url = "https://example.gov.cn/demo/history/yz-2024";
  const requirements: Requirement[] = [
    requirement(
      "demo-history-yz24-edu",
      "education",
      "本科及以上学历（示例公告原文）",
      { kind: "education", minLevel: "bachelor" },
      url,
      "示例：本科及以上学历。",
    ),
    chineseMajorRequirement(
      "demo-history-yz24-major",
      url,
      "示例：中国语言文学类。",
    ),
    requirement(
      "demo-history-yz24-cert",
      "teacher_cert",
      "初级中学及以上语文教师资格（示例公告原文）",
      {
        kind: "teacher_cert",
        subject: "chinese",
        stage: "middle",
        acceptInProgress: true,
        acceptHigherStage: true,
      },
      url,
      "示例：须具备初级中学及以上语文学科教师资格。",
    ),
    requirement(
      "demo-history-yz24-hukou",
      "hukou",
      "浙江省户籍或生源（示例公告原文）",
      { kind: "hukou", allowedRegionCodes: ["330000"], label: "浙江省户籍或生源" },
      url,
      "示例：浙江省户籍或生源。",
    ),
  ];
  return {
    id,
    title: "2024年宁波市鄞州区教育系统公开招聘教师公告（示例）",
    publisher: "宁波市鄞州区教育局（示例）",
    organizationType: "government_unified",
    officialUrl: url,
    subjectScope: ["chinese"],
    region: { code: "330212", province: "浙江省", city: "宁波市", district: "鄞州区" },
    lifecycle: "active",
    firstPublishedAt: "2024-04-25T09:30:00+08:00",
    versions: [
      v1(
        id,
        "2024-04-25T09:30:00+08:00",
        url,
        "示例：鄞州区公开招聘初中语文教师4名，员额制管理。",
        {
          registrationStart: "2024-05-13",
          registrationEnd: "2024-05-20",
          writtenExamDate: "2024-06-01",
          interviewDate: "2024-06-15",
        },
        [
          historyUnit(id, {
            id: "demo-history-yz24-middle-chinese-01",
            code: "YZ2024-示例01",
            name: "鄞州示例初中岗位组·初中语文教师（2024年批次）",
            region: { code: "330212", province: "浙江省", city: "宁波市", district: "鄞州区" },
            stage: "middle",
            headcount: 4,
            nature: NATURE_QUOTA,
            allocation: ALLOC_ASSIGN,
            teachingScope: "鄞州区教育局下属初中，统一调配",
            schoolPlacement: {
              status: "unspecified",
              note: "示例：岗位组统一招聘，录取后统一调配",
            },
            requirements,
            materials: historyMaterials(url),
          }),
        ],
      ),
    ],
    sourceHealth: { ok: true, checkedAt: HISTORY_CHECKED_AT, failReason: null },
  };
}

/** 往年参考演示公告（固定日期，不滚动；全部为虚构示例） */
export const V61_HISTORY_ANNOUNCEMENTS: readonly RecruitmentAnnouncement[] = [
  hangzhou2025(),
  suzhou2025(),
  nanjing2024(),
  yinzhou2024(),
];

export function getDemoHistoryAnnouncements(): RecruitmentAnnouncement[] {
  return [...V61_HISTORY_ANNOUNCEMENTS];
}
