/**
 * 首批地区真实招聘事件台账（模块 1，人工可维护的结构化镜像）。
 *
 * 与 catalog.ts 演示数据（example.gov.cn 占位）严格分离：
 * - dataset='real'、reviewStatus='ai_reviewed_pending'：2026-10-06 由 AI 依据
 *   官方公告页与岗位表附件初核，尚未经人工复核；
 * - 所有高影响字段证据 state='ai_extracted'，evidence_not_reviewed 闸门失败，
 *   因此这 3 条记录当前都不会进入「初步符合」主要推荐；
 * - 每条岗位都带来源栏目原文 URL + 岗位表附件定位（附件名/序号/行）+ 原文摘录，
 *   卡片可逐层追到官方依据；
 * - 当前 2 条报名已截止、1 条为预告（报名时间未公布），均非在报批次。
 *
 * 人工复核后：把对应 EvidenceAnchor.state 改为 'official'、
 * reviewStatus 改为 'human_reviewed' 并登记 reviewedBy/reviewedAt；
 * 延期/取消/补充公告走新版本追加，旧版本只标记 superseded 不删除。
 */
import type {
  AllocationMethod,
  AnnouncementSourceKind,
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
} from './types.js';
import { COVERAGE_CHECKED_AT } from './coverage.js';

/** 真实台账数据版本 */
export const REAL_CATALOG_VERSION = 'kb-real-catalog-1.1.0';

/** 本轮 AI 初核时间（与覆盖巡检时间一致） */
export const REAL_CHECKED_AT = COVERAGE_CHECKED_AT;

// ==================== 官方来源 URL（公告页 + 岗位表附件） ====================

const YZ_ARTICLE =
  'https://www.nbyz.gov.cn/col/col1229117192/art/2026/art_8f2e87adf2fa4eb1a544f6693151914f.html';
const YZ_XLS =
  'https://www.nbyz.gov.cn/api-gateway/jpaas-web-server/front/document/download?fileUrl=YW5UzzlvCwcM%2FNHHX%2FtT6GUZ07qbvoT0zQgyWcmWMDhtVLmqciuNVjXfSABYngWFI0OuYL8lgSnHjVKiSOLwReBz%2B1Y2J290Jn21UqnnY2felEa80cWnh8HFrm%2FRP6Ngpt9AptX%2BPISvTDs08ABw4xBqd5BuWF5dVkHYHBHgtz8%3D&fileName=%E9%99%84%E4%BB%B61.2026%E5%B9%B4%E5%AE%81%E6%B3%A2%E5%B8%82%E9%84%9E%E5%B7%9E%E5%8C%BA%E6%95%99%E8%82%B2%E7%B3%BB%E7%BB%9F%E5%85%AC%E5%BC%80%E6%8B%9B%E8%81%98%E4%BA%8B%E4%B8%9A%E7%BC%96%E5%88%B6%E6%95%99%E5%B8%88%E5%85%AC%E5%91%8A%E5%B2%97%E4%BD%8D%E8%AE%A1%E5%88%92%E8%A1%A8.xls';
const YZ_XLS_NAME =
  '附件1.2026年宁波市鄞州区教育系统公开招聘事业编制教师公告岗位计划表.xls';

const HZ_ARTICLE =
  'https://edu.hangzhou.gov.cn/col/col1228921906/art/2026/art_147a30023988407aa66810d0e74c65f2.html';
const HZ_ET =
  'https://edu.hangzhou.gov.cn/api-gateway/jpaas-web-server/front/document/download?fileUrl=YW5UzzlvCwcM%2FNHHX%2FtT6M69HkaxEWgKYFj0xqXO7Jb4H1m6BinzROgFd6d4DbW0U5ua8BGrybNOss36K4mL5O0cCowSWUotIceKUCQ1XrDRYG6Z9lTlEHqd9uFAxGcJR1ovxXacUECq3HE9j9fGSQD439veWhCtDOV5qCCEMJ8%3D&fileName=%E9%99%84%E4%BB%B61%E6%9D%AD%E5%B7%9E%E5%B8%82%E6%95%99%E8%82%B2%E5%B1%80%E6%89%80%E5%B1%9E%E4%BA%8B%E4%B8%9A%E5%8D%95%E4%BD%8D2026%E5%B9%B44%E6%9C%88%E6%89%B9%E6%AC%A1%E5%85%AC%E5%BC%80%E6%8B%9B%E8%81%98%E8%AE%A1%E5%88%92%E8%A1%A8.et';
const HZ_ET_NAME =
  '附件1杭州市教育局所属事业单位2026年4月批次公开招聘计划表.et';

const NB_ARTICLE =
  'http://jyj.ningbo.gov.cn/col/col1229166692/art/2026/art_c58c701a5e034741ab977dfe7f771545.html';
const NB_XLSX =
  'http://jyj.ningbo.gov.cn/api-gateway/jpaas-web-server/front/document/download?fileUrl=YW5UzzlvCwcM%2FNHHX%2FtT6DH%2BG3pTGOqkfsODGmLYmCm1lHCK%2B1gl48ZNeA8RtrsUDdmnE8nE%2B2XWeUZq60PeVax0qZp4DCsKpMsBEzJB4yiOa9WnyMp0gTSWms72sQjoUNYYpzcmykLuoqDgJi0ReUp1JmLFLptgx%2BAxFg3Q2cc%3D&fileName=%E9%99%84%E4%BB%B61%EF%BC%9A%E6%8B%9B%E8%81%98%E5%8D%95%E4%BD%8D%E5%B2%97%E4%BD%8D%E5%AD%A6%E5%8E%86%E4%B8%93%E4%B8%9A%E5%8F%8A%E8%B5%84%E6%A0%BC%E6%9D%A1%E4%BB%B6%E8%A1%A8.xlsx';
const NB_XLSX_NAME = '附件1：招聘单位岗位学历专业及资格条件表.xlsx';

// ==================== 构造助手（全部锚点为 AI 初核态） ====================

function aiAnchor(
  id: string,
  url: string,
  anchor: string,
  excerpt: string,
): EvidenceAnchor {
  const locator: EvidenceLocator = { kind: 'url', url, anchor };
  return {
    id,
    locator,
    excerpt,
    state: 'ai_extracted',
    checkedAt: REAL_CHECKED_AT,
  };
}

function req(
  id: string,
  dimension: RequirementDimension,
  description: string,
  criterion: RequirementCriterion,
  evidenceUrl: string,
  anchor: string,
  excerpt: string,
  hard = true,
): Requirement {
  return {
    id,
    dimension,
    description,
    hard,
    criterion,
    evidence: aiAnchor(`${id}-ev`, evidenceUrl, anchor, excerpt),
  };
}

const NATURE_PUBLIC_YZ: EmploymentNature = {
  code: 'public_institution_staff',
  officialName: '事业编制教师（签订事业单位聘用合同，服务期不少于5年）',
};
const NATURE_PUBLIC_HZ: EmploymentNature = {
  code: 'public_institution_staff',
  officialName: '财政全额拨款事业编制',
};
const NATURE_PUBLIC_NB: EmploymentNature = {
  code: 'public_institution_staff',
  officialName: '财政全额补助事业编制',
};

const ALLOC_OTHER: AllocationMethod = {
  code: 'other',
  description: '岗位分配方式以公告及岗位计划表为准（待人工复核）',
};
const ALLOC_DIRECT: AllocationMethod = {
  code: 'direct_school',
  description: '按报考学校直接定岗',
};

interface RealUnitSpec {
  id: string;
  code: string;
  name: string;
  region: RegionRef;
  stage: StageCode;
  headcount: number;
  nature: EmploymentNature;
  allocation: AllocationMethod;
  teachingScope?: string;
  /** 具体任教学校定岗状态；岗位组/统一调配批次必须显式给 unspecified */
  schoolPlacement?: SchoolPlacement;
  registerUrl?: string;
  requirements: Requirement[];
  sourceRow: EvidenceAnchor;
  materials?: MaterialItem[];
}

function unit(announcementId: string, spec: RealUnitSpec): ApplicationUnit {
  return {
    id: spec.id,
    code: spec.code,
    name: spec.name,
    announcementId,
    versionId: `${announcementId}-v1`,
    region: spec.region,
    teachingScope: spec.teachingScope,
    schoolPlacement: spec.schoolPlacement,
    subject: 'chinese',
    stage: spec.stage,
    headcount: spec.headcount,
    organizationType: 'government_unified',
    employmentNature: spec.nature,
    allocation: spec.allocation,
    registerUrl: spec.registerUrl,
    requirements: spec.requirements,
    sourceRow: spec.sourceRow,
    materials: spec.materials,
  };
}

function v1(
  announcementId: string,
  publishedAt: string,
  sourceUrl: string,
  excerpt: string,
  timeline: AnnouncementTimeline,
  units: ApplicationUnit[],
  changeNote?: string,
): AnnouncementVersion {
  return {
    id: `${announcementId}-v1`,
    announcementId,
    versionNumber: 1,
    sourceKind: 'original' as AnnouncementSourceKind,
    publishedAt,
    officialSource: aiAnchor(
      `${announcementId}-v1-src`,
      sourceUrl,
      '公告官方发布页',
      excerpt,
    ),
    timeline,
    units,
    changeNote,
  };
}

const HEALTHY = {
  ok: true as const,
  checkedAt: REAL_CHECKED_AT,
  failReason: null,
};

// ==================== ① 鄞州 2026-07-31 预告批次（39 名，语文 7 名） ====================

function yinzhou(): RecruitmentAnnouncement {
  const id = 'real-yinzhou-2026-autumn';
  const requirements: Requirement[] = [
    req(
      'real-yz-edu',
      'education',
      '岗位计划表要求研究生及以上学历、学位；国/省政府奖学金或部属、省属重点师范院校综合成绩前5%的应届师范本科毕业生可放宽至本科（详见附件1序号1及附件2高校名单）',
      { kind: 'education', minLevel: 'master' },
      YZ_XLS,
      `${YZ_XLS_NAME} · 明细 · 序号1`,
      '序号1 初中语文教师：学历要求研究生及以上；符合公告列明奖项/排名条件的应届师范本科生可放宽至本科。',
    ),
    req(
      'real-yz-degree',
      'degree',
      '研究生及以上学历、学位（放宽条件同上）',
      { kind: 'degree', requiredDegree: 'master' },
      YZ_XLS,
      `${YZ_XLS_NAME} · 明细 · 序号1`,
      '序号1：学历/学位要求研究生及以上。',
    ),
    req(
      'real-yz-major',
      'major',
      '本科阶段为中国语言文学类；研究生阶段为中国语言文学、课程与教学论、学科教学（语文）、汉语国际教育等（以附件1序号1专业要求为准）',
      {
        kind: 'major',
        majorNames: [
          '中国语言文学类',
          '汉语言文学',
          '汉语言文学（师范）',
          '中国语言文学',
          '课程与教学论',
          '学科教学（语文）',
          '汉语国际教育',
        ],
        catalogGroups: ['中国语言文学类'],
      },
      YZ_XLS,
      `${YZ_XLS_NAME} · 明细 · 序号1`,
      '序号1 专业要求：本科中国语言文学类；研究生中国语言文学、课程与教学论、学科教学（语文）、汉语国际教育等。',
    ),
    req(
      'real-yz-fresh',
      'graduate_status',
      '招聘对象为2024、2025、2026届普通高校毕业生及2027年应届毕业生（含按国家政策享受应届待遇人员），详见公告第五条',
      { kind: 'graduate_status', requireFresh: true },
      YZ_ARTICLE,
      '公告正文 · 五、其他事项 第2、3项',
      '2024年、2025年和2026年普通高校毕业生……以及按国家政策规定可以享受应届毕业生就业待遇的其他情形人员，须如期取得相应学历学位证书。',
    ),
    req(
      'real-yz-cert',
      'teacher_cert',
      '须取得初级或高级中学教师资格证或教师资格考试合格证明（2026-07-31前取得）；2027届应届可在聘用之日起1年内取得',
      {
        kind: 'teacher_cert',
        subject: 'chinese',
        stage: 'middle',
        acceptInProgress: true,
      },
      YZ_ARTICLE,
      '公告正文 · 五、其他事项 第2项',
      '报考人员须取得初级或高级中学教师资格证或教师资格考试合格证明……2027年普通高校应届毕业生须在2027年8月31日（含）前取得学历学位证书，且在聘用之日起1年内取得相应岗位学科所需的教师资格证书。',
    ),
    req(
      'real-yz-age',
      'age',
      '1987年7月31日及以后出生（附件1序号1）',
      { kind: 'age', maxAgeYears: 39, referenceDate: '2026-07-31' },
      YZ_XLS,
      `${YZ_XLS_NAME} · 明细 · 序号1`,
      '序号1：年龄要求1987年7月31日及以后出生。',
    ),
    req(
      'real-yz-hukou',
      'hukou',
      '浙江省户籍或浙江生源；附件2所列部分高校毕业生户籍不限（具体高校范围以附件2为准）',
      {
        kind: 'hukou',
        allowedRegionCodes: ['330000'],
        label: '浙江省户籍或生源（部分高校不限）',
      },
      YZ_XLS,
      `${YZ_XLS_NAME} · 明细 · 序号1`,
      '序号1：户籍/生源要求为浙江省（附件2所列相关高校毕业生不限户籍，具体名单待复核）。',
    ),
  ];
  const sourceRow = aiAnchor(
    'real-yz-row',
    YZ_XLS,
    `${YZ_XLS_NAME} · 明细工作表 · 序号1`,
    '序号1 初中语文教师，招聘人数7名（全区合计39名）。',
  );
  const units = [
    unit(id, {
      id: 'real-yz-2026-chinese-01',
      code: 'YZ2026-序号1',
      name: '鄞州区教育系统·初中语文教师（岗位计划表序号1）',
      region: {
        code: '330212',
        province: '浙江省',
        city: '宁波市',
        district: '鄞州区',
      },
      stage: 'middle',
      headcount: 7,
      nature: NATURE_PUBLIC_YZ,
      allocation: ALLOC_OTHER,
      teachingScope: '鄞州区教育局下属学校，具体定岗学校以岗位计划表为准',
      schoolPlacement: {
        status: 'unspecified',
        note: '预告批次岗位计划表仅列「初中语文教师」岗位组（序号1，招7名），未逐校列明定岗学校；录取后定岗学校以官方分配规则及岗位计划表为准',
      },
      requirements,
      sourceRow,
    }),
  ];
  return {
    id,
    title: '2026年宁波市鄞州区教育系统公开招聘事业编制教师公告',
    publisher: '宁波市鄞州区教育局',
    organizationType: 'government_unified',
    officialUrl: YZ_ARTICLE,
    subjectScope: ['chinese'],
    region: { code: '330212', province: '浙江省', city: '宁波市', district: '鄞州区' },
    lifecycle: 'active',
    firstPublishedAt: '2026-07-31T11:53:00+08:00',
    versions: [
      v1(
        id,
        '2026-07-31T11:53:00+08:00',
        YZ_ARTICLE,
        '宁波市鄞州区教育局决定公开招聘事业编制教师39名……报名时间：初定2026年9月（具体时间另行通知）。截至2026-10-06官方尚未发布报名通知。',
        {
          pendingItems: [
            '报名具体时间（公告称初定2026年9月，截至2026-10-06未见后续通知）',
            '资格复审与考试的具体时间、地点（公告称初定在金华，另行通知）',
          ],
        },
        units,
      ),
    ],
    dataset: 'real',
    reviewStatus: 'ai_reviewed_pending',
    reviewedBy: null,
    reviewedAt: null,
    sourceHealth: HEALTHY,
  };
}

// ==================== ② 杭州市教育局 2026 年 4 月批次（32 家单位 171 名，已结束） ====================

function hangzhouRequirements(seq: 5 | 6): Requirement[] {
  const rowAnchor = `${HZ_ET_NAME} · 明细 · 序号${seq}`;
  return [
    req(
      `real-hz-${seq}-edu`,
      'education',
      '附件1计划表该岗位要求本科及以上学历（研究生可报），以序号行原文为准',
      { kind: 'education', minLevel: 'bachelor' },
      HZ_ET,
      rowAnchor,
      `序号${seq}：本科及以上学历（具体学历层次以计划表该行为准）。`,
    ),
    req(
      `real-hz-${seq}-major`,
      'major',
      '研究生：中国语言文学类、汉语国际教育类、学科教学（语文）、课程与教学论（语文方向）；本科：中国语言文学类（以附件1序号行为准）',
      {
        kind: 'major',
        majorNames: [
          '中国语言文学类',
          '汉语言文学',
          '汉语言文学（师范）',
          '汉语国际教育',
          '汉语国际教育类',
          '课程与教学论',
          '学科教学（语文）',
        ],
        catalogGroups: ['中国语言文学类'],
      },
      HZ_ET,
      rowAnchor,
      `序号${seq} 专业要求：研究生中国语言文学类/汉语国际教育类/学科教学（语文）/课程与教学论（语文方向），本科中国语言文学类。`,
    ),
    req(
      `real-hz-${seq}-age`,
      'age',
      '1987年4月1日以后出生；具有高级职称的可放宽至1980年4月1日以后出生',
      { kind: 'age', maxAgeYears: 38, referenceDate: '2026-04-01' },
      HZ_ARTICLE,
      '公告正文 · 二（二）招聘条件 第4项',
      '年龄要求在1987年4月1日以后出生，具有高级职称的可放宽至1980年4月1日以后出生，具体年龄要求以各招聘岗位的年龄条件为准。',
    ),
    req(
      `real-hz-${seq}-cert`,
      'teacher_cert',
      '2026届本科毕业生报到录用前须取得适用教师资格证（或合格证明），语文教师普通话二级甲等；其他人员报名时须具备（公告第二条第5款）',
      {
        kind: 'teacher_cert',
        subject: 'chinese',
        stage: 'high',
        acceptInProgress: true,
      },
      HZ_ARTICLE,
      '公告正文 · 二（二）招聘条件 第5项',
      '2026届本科毕业生报考文化课教师岗位的，要求在报到录用前必须取得适用的教师资格证书（或国家教师资格考试合格证明）和普通话等级证书（应聘语文教师普通话水平要求二级甲等及以上）。',
    ),
    req(
      `real-hz-${seq}-target`,
      'other',
      '招聘对象分三类：在职教师、2026届应届毕业生（2024/2025届可按应届报考）、社会人员（须研究生学历硕士学位），适用类别需结合个人情况确认',
      { kind: 'other', manualReview: true },
      HZ_ARTICLE,
      '公告正文 · 二（一）招聘对象',
      '教师类岗位招聘对象为以下三类人员：1.在职教师；2.应届毕业生（2026届，2024届、2025届可按应届毕业生报考）；3.社会人员，指具有研究生学历、硕士及以上学位的人员。',
    ),
  ];
}

function hangzhouMaterials(): MaterialItem[] {
  const mat = (id: string, label: string, audience: string, required: boolean, anchor: string, excerpt: string): MaterialItem => ({
    id,
    label,
    applicableAudience: audience,
    required,
    source: aiAnchor(`real-hz-mat-${id}`, HZ_ARTICLE, `公告正文 · ${anchor}`, excerpt),
  });
  return [
    mat('id-card', '身份证', '所有报考者', true, '报名材料', '报名时须提供本人有效身份证件。'),
    mat('edu-cert', '学历、学位证书', '所有报考者', true, '报名材料', '须提供学历证书、学位证书原件及复印件。'),
    mat('teacher-cert', '教师资格证书', '所有报考者', true, '报名材料', '须提供相应学科教师资格证书。'),
    mat('mandarin', '普通话水平测试等级证书', '语文岗位报考者', true, '报名材料', '语文教师岗位须提供二级甲等及以上普通话证书。'),
    mat('registration-form', '报名登记表', '所有报考者', true, '报名材料', '在报名系统填写并打印报名登记表。'),
  ];
}

function hangzhou(): RecruitmentAnnouncement {
  const id = 'real-hangzhou-2026-04';
  const excerpt =
    '杭州市教育局所属杭州高级中学等32家事业单位公开招聘事业编制人员171名；经费形式均为财政全额拨款，被聘用人员均列入事业编制。报名时间2026年5月6日—5月11日，笔试5月24日，面试5月31日。';
  const timeline: AnnouncementTimeline = {
    registrationStart: '2026-05-06',
    registrationEnd: '2026-05-11',
    writtenExamDate: '2026-05-24',
    interviewDate: '2026-05-31',
  };
  const units = [
    unit(id, {
      id: 'real-hz-202604-fuchun-chinese',
      code: 'HZ202604-序号5',
      name: '杭州第二中学富春学校·高中语文教师（计划表序号5）',
      region: {
        code: '330111',
        province: '浙江省',
        city: '杭州市',
        district: '富阳区',
      },
      stage: 'high',
      headcount: 4,
      nature: NATURE_PUBLIC_HZ,
      allocation: ALLOC_DIRECT,
      teachingScope: '杭州第二中学富春学校（富阳区）',
      schoolPlacement: {
        status: 'specified',
        schoolName: '杭州第二中学富春学校',
      },
      registerUrl: 'https://jszp.hzedu.gov.cn/',
      requirements: hangzhouRequirements(5),
      sourceRow: aiAnchor(
        'real-hz-5-row',
        HZ_ET,
        `${HZ_ET_NAME} · 明细工作表 · 序号5`,
        '序号5 杭州第二中学富春学校 高中语文教师，招聘人数4名（富阳区）。',
      ),
      materials: hangzhouMaterials(),
    }),
    unit(id, {
      id: 'real-hz-202604-gaoxin-chinese',
      code: 'HZ202604-序号6',
      name: '杭州第二中学高新学校·高中语文教师（计划表序号6）',
      region: {
        code: '330108',
        province: '浙江省',
        city: '杭州市',
        district: '滨江区',
      },
      stage: 'high',
      headcount: 1,
      nature: NATURE_PUBLIC_HZ,
      allocation: ALLOC_DIRECT,
      teachingScope: '杭州第二中学高新学校（滨江区）',
      schoolPlacement: {
        status: 'specified',
        schoolName: '杭州第二中学高新学校',
      },
      registerUrl: 'https://jszp.hzedu.gov.cn/',
      requirements: hangzhouRequirements(6),
      sourceRow: aiAnchor(
        'real-hz-6-row',
        HZ_ET,
        `${HZ_ET_NAME} · 明细工作表 · 序号6`,
        '序号6 杭州第二中学高新学校 高中语文教师，招聘人数1名（滨江区）。',
      ),
      materials: hangzhouMaterials(),
    }),
  ];
  return {
    id,
    title: '杭州市教育局所属事业单位2026年4月批次公开招聘公告',
    publisher: '杭州市教育局（教师工作处）',
    organizationType: 'institution_unified',
    officialUrl: HZ_ARTICLE,
    subjectScope: ['chinese'],
    region: { code: '330100', province: '浙江省', city: '杭州市' },
    lifecycle: 'active',
    firstPublishedAt: '2026-04-28T15:53:00+08:00',
    versions: [
      v1(id, '2026-04-28T15:53:00+08:00', HZ_ARTICLE, excerpt, timeline, units),
    ],
    dataset: 'real',
    reviewStatus: 'ai_reviewed_pending',
    reviewedBy: null,
    reviewedAt: null,
    sourceHealth: HEALTHY,
    contactInfo: '杭州市教育局教师工作处，咨询电话见公告原文末尾「报名咨询」栏目',
  };
}

// ==================== ③ 宁波市教育局直属 2026-07 批次（18 校 76 名，已结束） ====================

function ningbo(): RecruitmentAnnouncement {
  const id = 'real-ningbo-2026-07';
  const requirements: Requirement[] = [
    req(
      'real-nb-edu',
      'education',
      '附件1该行：硕士研究生及以上；本科限公费师范生，或具备地市级优质课一等奖、县级骨干教师、高级教师等条件之一者（具体以宁波外国语学校高中语文教师行原文为准，待人工复核）',
      { kind: 'education', minLevel: 'bachelor' },
      NB_XLSX,
      `${NB_XLSX_NAME} · 宁波外国语学校 · 高中语文教师行`,
      '宁波外国语学校高中语文教师：研究生硕士及以上；本科限公费师范生或具备公告列明的地市级优质课一等奖、县级骨干教师、高级教师等条件。',
    ),
    req(
      'real-nb-major',
      'major',
      '中国语言文学类、课程与教学论（语文）、学科教学（语文）等（以附件1该行专业要求为准）',
      {
        kind: 'major',
        majorNames: [
          '中国语言文学类',
          '汉语言文学',
          '汉语言文学（师范）',
          '课程与教学论',
          '学科教学（语文）',
        ],
        catalogGroups: ['中国语言文学类'],
      },
      NB_XLSX,
      `${NB_XLSX_NAME} · 宁波外国语学校 · 高中语文教师行`,
      '该行专业要求：中国语言文学类、课程与教学论（语文）、学科教学（语文）。',
    ),
    req(
      'real-nb-age',
      'age',
      '38周岁以下；骨干教师、高级教师等可放宽至40周岁（以附件1该行原文为准）',
      { kind: 'age', maxAgeYears: 38, referenceDate: '2026-07-09' },
      NB_XLSX,
      `${NB_XLSX_NAME} · 宁波外国语学校 · 高中语文教师行`,
      '该行年龄要求：38周岁以下（骨干教师/高级教师放宽至40周岁，具体以岗位表为准）。',
    ),
    req(
      'real-nb-cert',
      'teacher_cert',
      '普通高校应届毕业生暂不要求提供教师资格证书，办理聘用手续前须取得；其他人员按岗位要求提供（公告第三条第3款）',
      {
        kind: 'teacher_cert',
        subject: 'chinese',
        stage: 'high',
        acceptInProgress: true,
      },
      NB_ARTICLE,
      '公告正文 · 三、招聘对象和条件 （三）第2项',
      '普通高校应届毕业生，应聘教师岗位暂不要求提供教师资格证书，但在办理聘用手续前须取得相应教师资格证书。',
    ),
  ];
  const units = [
    unit(id, {
      id: 'real-nb-202607-nwsis-chinese',
      code: 'NB202607-宁外-高中语文',
      name: '宁波外国语学校·高中语文教师',
      region: { code: '330200', province: '浙江省', city: '宁波市' },
      stage: 'high',
      headcount: 2,
      nature: NATURE_PUBLIC_NB,
      allocation: ALLOC_DIRECT,
      teachingScope: '宁波市教育局直属·宁波外国语学校（面向全国招聘）',
      schoolPlacement: {
        status: 'specified',
        schoolName: '宁波外国语学校',
      },
      registerUrl:
        'https://nbeea.nbedu.net.cn/#/teacherE?No=603&type=2&newsId=1973',
      requirements,
      sourceRow: aiAnchor(
        'real-nb-row',
        NB_XLSX,
        `${NB_XLSX_NAME} · 宁波外国语学校 · 高中语文教师行`,
        '宁波外国语学校 高中语文教师，招聘人数2名（直属18校合计76名）。',
      ),
    }),
  ];
  return {
    id,
    title: '宁波市教育局直属学校公开招聘事业编制教师公告',
    publisher: '宁波市教育局',
    organizationType: 'government_unified',
    officialUrl: NB_ARTICLE,
    subjectScope: ['chinese'],
    region: { code: '330200', province: '浙江省', city: '宁波市' },
    lifecycle: 'active',
    firstPublishedAt: '2026-07-09T16:41:00+08:00',
    versions: [
      v1(
        id,
        '2026-07-09T16:41:00+08:00',
        NB_ARTICLE,
        '宁波市教育局直属18所学校面向全国公开招聘事业编制教师共76名，经费预算形式为财政全额补助；网上报名自公告发布之日至2026年7月16日，笔试初定7月18日。该批次后续已发布拟聘用人员公示（见人才招聘栏目）。',
        {
          registrationStart: '2026-07-09',
          registrationEnd: '2026-07-16',
          writtenExamDate: '2026-07-18',
          pendingItems: ['笔试具体时间、地点由各招聘学校另行通知'],
        },
        units,
      ),
    ],
    dataset: 'real',
    reviewStatus: 'ai_reviewed_pending',
    reviewedBy: null,
    reviewedAt: null,
    sourceHealth: HEALTHY,
  };
}

/** 首批真实监测台账公告（3 条，含 4 个语文报考单元） */
export const REAL_ANNOUNCEMENTS: readonly RecruitmentAnnouncement[] = [
  yinzhou(),
  hangzhou(),
  ningbo(),
];

export const REAL_ANNOUNCEMENT_IDS = {
  yinzhouPreview: 'real-yinzhou-2026-autumn',
  hangzhou202604: 'real-hangzhou-2026-04',
  ningbo202607: 'real-ningbo-2026-07',
} as const;
