/**
 * v7.2 工作包 3：已发布公告版本 → 匹配领域对象投影（纯函数）。
 *
 * 契约：`PublishedAnnouncementVersion.payload` 为目录载荷
 *   { dataset, announcement, version }
 * （与 tests/fixtures/samples/published-announcement.ts 一致），
 * 投影后得到 `RecruitmentAnnouncement` 的一个版本。
 *
 * 原则（PRD 8.2 / 7.13）：
 * - 严格结构校验：缺字段、类型错误、枚举越界一律抛 `ProjectionError`；
 * - 绝不静默返回空/部分数据——结构异常视为故障，交由上层跳过或回退；
 * - lifecycle 以数据库行状态为准，不从载荷自述取信。
 */
import type {
  AnnouncementSourceKind,
  AnnouncementVersion,
  RecruitmentAnnouncement,
} from '../matching/types.js';

/** 投影失败：携带出错的字段路径，便于定位结构异常（不可静默） */
export class ProjectionError extends Error {
  readonly fieldPath: string;
  constructor(fieldPath: string, message: string) {
    super(`${fieldPath}: ${message}`);
    this.name = 'ProjectionError';
    this.fieldPath = fieldPath;
  }
}

/** 目录载荷的 dataset 取值；`test` 仅供测试样本显式标注 */
export type CatalogDataset = 'test' | 'demo' | 'real';

const ORGANIZATION_TYPES = [
  'government_unified',
  'institution_unified',
  'other',
] as const;
const SOURCE_KINDS: readonly AnnouncementSourceKind[] = [
  'original',
  'supplement',
  'correction',
];
const EVIDENCE_STATES = ['official', 'ai_extracted', 'pending_review'];
const MAJOR_STAGES = [
  'secondary',
  'college',
  'bachelor',
  'master',
  'doctorate',
] as const;

/** 投影输入：数据库行中投影所需的最小字段 */
export interface CatalogRowInput {
  id: string;
  announcementId: string;
  versionNumber: number;
  status: string;
  payload: unknown;
}

export interface ProjectedCatalogVersion {
  announcement: RecruitmentAnnouncement;
  version: AnnouncementVersion;
}

function fail(path: string, message: string): never {
  throw new ProjectionError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, '必须是对象');
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0)
    fail(path, '必须是非空字符串');
  return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(path, '必须是字符串');
  return value;
}

function isoAt(value: unknown, path: string): string {
  const raw = stringAt(value, path);
  if (Number.isNaN(new Date(raw).getTime())) fail(path, '不是合法日期');
  return raw;
}

function intAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    fail(path, '必须是整数');
  return value;
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    fail(path, `取值必须是 ${allowed.join(' / ')} 之一`);
  return value as T;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  return value;
}

function regionAt(value: unknown, path: string) {
  const region = recordAt(value, path);
  return {
    code: stringAt(region.code, `${path}.code`),
    province: stringAt(region.province, `${path}.province`),
    ...(optionalStringAt(region.city, `${path}.city`) !== undefined
      ? { city: region.city as string }
      : {}),
    ...(optionalStringAt(region.district, `${path}.district`) !== undefined
      ? { district: region.district as string }
      : {}),
  };
}

function evidenceAt(value: unknown, path: string) {
  const anchor = recordAt(value, path);
  const locator = recordAt(anchor.locator, `${path}.locator`);
  const kind = enumAt(
    locator.kind,
    ['url', 'file', 'worksheet', 'excerpt'] as const,
    `${path}.locator.kind`,
  );
  const requiredKeys = kind === 'url' ? ['url'] : kind === 'excerpt' ? ['excerpt']
    : kind === 'worksheet' ? ['fileId', 'fileName', 'sheet'] : ['fileId', 'fileName'];
  for (const key of requiredKeys) stringAt(locator[key], `${path}.locator.${key}`);
  return {
    ...(isRecord(anchor.locatorData) ? { locatorData: anchor.locatorData } : {}),
    id: stringAt(anchor.id, `${path}.id`),
    locator: {
      kind,
      ...(optionalStringAt(locator.url, `${path}.locator.url`) !== undefined
        ? { url: locator.url as string }
        : {}),
      ...(optionalStringAt(locator.anchor, `${path}.locator.anchor`) !== undefined
        ? { anchor: locator.anchor as string }
        : {}),
      ...(optionalStringAt(locator.fileId, `${path}.locator.fileId`) !== undefined
        ? { fileId: locator.fileId as string }
        : {}),
      ...(optionalStringAt(locator.fileName, `${path}.locator.fileName`) !==
      undefined
        ? { fileName: locator.fileName as string }
        : {}),
      ...(optionalStringAt(locator.sheet, `${path}.locator.sheet`) !== undefined
        ? { sheet: locator.sheet as string }
        : {}),
      ...(optionalStringAt(locator.cell, `${path}.locator.cell`) !== undefined
        ? { cell: locator.cell as string }
        : {}),
      ...(optionalStringAt(locator.excerpt, `${path}.locator.excerpt`) !==
      undefined
        ? { excerpt: locator.excerpt as string }
        : {}),
      ...(typeof locator.page === 'number' ? { page: locator.page } : {}),
    },
    ...(optionalStringAt(anchor.excerpt, `${path}.excerpt`) !== undefined
      ? { excerpt: anchor.excerpt as string }
      : {}),
    state: enumAt(anchor.state, EVIDENCE_STATES, `${path}.state`),
    checkedAt: isoAt(anchor.checkedAt, `${path}.checkedAt`),
  } as AnnouncementVersion['officialSource'];
}

/**
 * 专业条件（criterion.kind='major'）结构校验。
 *
 * 只校验「分阶段口径」的显式结构；旧发布版本没有 stages/stageMode 时照常通过
 * （兼容旧数据，且绝不把缺失解释为“最高学历阶段要求”）。
 */
function validateMajorCriterion(
  criterion: Record<string, unknown>,
  path: string,
): void {
  const names = criterion.majorNames;
  if (!Array.isArray(names) || names.some((item) => typeof item !== 'string')) {
    fail(`${path}.majorNames`, '必须是字符串数组');
  }
  if (criterion.catalogGroups !== undefined && !Array.isArray(criterion.catalogGroups)) {
    fail(`${path}.catalogGroups`, '必须是数组');
  }
  if (criterion.ambiguous !== undefined && typeof criterion.ambiguous !== 'boolean') {
    fail(`${path}.ambiguous`, '必须是布尔值');
  }
  if (criterion.stages === undefined) {
    if (criterion.stageMode !== undefined) {
      fail(`${path}.stageMode`, '必须与 stages 同时出现');
    }
    return;
  }
  const stages = criterion.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    fail(`${path}.stages`, '必须是非空数组');
  }
  for (const stage of stages) {
    enumAt(stage, MAJOR_STAGES, `${path}.stages[]`);
  }
  // 多阶段必须明确任一/同时，不接受“系统默认”。
  if (stages.length > 1 && criterion.stageMode !== 'any' && criterion.stageMode !== 'all') {
    fail(`${path}.stageMode`, '多阶段专业要求必须明确 any 或 all');
  }
  if (
    criterion.stageMode !== undefined &&
    criterion.stageMode !== 'any' &&
    criterion.stageMode !== 'all'
  ) {
    fail(`${path}.stageMode`, '只能是 any 或 all');
  }
}

function requirementAt(value: unknown, path: string) {
  const req = recordAt(value, path);
  const dimension = enumAt(
    req.dimension,
    [
      'region',
      'education',
      'degree',
      'major',
      'graduate_status',
      'teacher_cert',
      'age',
      'hukou',
      'social_security',
      'work_experience',
      'other',
    ] as const,
    `${path}.dimension`,
  );
  const criterion = recordAt(req.criterion, `${path}.criterion`);
  // criterion.kind 必须存在且为字符串；具体分支结构由引擎消费，此处只做存在性校验
  const kind = stringAt(criterion.kind, `${path}.criterion.kind`);
  // 专业条件的分阶段口径（D03/R02）：结构非法一律拒绝，避免坏数据进入匹配。
  if (kind === 'major') validateMajorCriterion(criterion, `${path}.criterion`);
  const hard = req.hard;
  if (typeof hard !== 'boolean') fail(`${path}.hard`, '必须是布尔值');
  return {
    id: stringAt(req.id, `${path}.id`),
    dimension,
    description: stringAt(req.description, `${path}.description`),
    hard,
    criterion: criterion as never,
    evidence: evidenceAt(req.evidence, `${path}.evidence`),
  };
}

function unitAt(value: unknown, path: string) {
  const unit = recordAt(value, path);
  const employmentNature = recordAt(
    unit.employmentNature,
    `${path}.employmentNature`,
  );
  const allocation = recordAt(unit.allocation, `${path}.allocation`);
  return {
    id: stringAt(unit.id, `${path}.id`),
    code: stringAt(unit.code, `${path}.code`),
    name: stringAt(unit.name, `${path}.name`),
    announcementId: stringAt(unit.announcementId, `${path}.announcementId`),
    versionId: stringAt(unit.versionId, `${path}.versionId`),
    region: regionAt(unit.region, `${path}.region`),
    ...(optionalStringAt(unit.teachingScope, `${path}.teachingScope`) !==
    undefined
      ? { teachingScope: unit.teachingScope as string }
      : {}),
    subject: stringAt(unit.subject, `${path}.subject`),
    stage: stringAt(unit.stage, `${path}.stage`),
    headcount: intAt(unit.headcount, `${path}.headcount`),
    organizationType: enumAt(
      unit.organizationType,
      ORGANIZATION_TYPES,
      `${path}.organizationType`,
    ),
    employmentNature: {
      code: stringAt(employmentNature.code, `${path}.employmentNature.code`),
      officialName: stringAt(
        employmentNature.officialName,
        `${path}.employmentNature.officialName`,
      ),
    },
    allocation: {
      code: stringAt(allocation.code, `${path}.allocation.code`),
      description: stringAt(
        allocation.description,
        `${path}.allocation.description`,
      ),
    },
    ...(isRecord(unit.schoolPlacement)
      ? { schoolPlacement: unit.schoolPlacement as never }
      : {}),
    ...(optionalStringAt(unit.registerUrl, `${path}.registerUrl`) !== undefined
      ? { registerUrl: unit.registerUrl as string }
      : {}),
    ...(isRecord(unit.sourceRow)
      ? { sourceRow: evidenceAt(unit.sourceRow, `${path}.sourceRow`) }
      : {}),
    ...(unit.recruitmentOrganization !== undefined
      ? { recruitmentOrganization: stringAt(unit.recruitmentOrganization, `${path}.recruitmentOrganization`) } : {}),
    ...(unit.fieldEvidence !== undefined ? {
      fieldEvidence: Object.fromEntries(Object.entries(recordAt(unit.fieldEvidence, `${path}.fieldEvidence`))
        .map(([key, anchors]) => [key, arrayAt(anchors, `${path}.fieldEvidence.${key}`)
          .map((anchor, i) => evidenceAt(anchor, `${path}.fieldEvidence.${key}[${i}]`))])),
    } : {}),
    ...(Array.isArray(unit.materials)
      ? { materials: unit.materials as never }
      : {}),
    requirements: arrayAt(unit.requirements, `${path}.requirements`).map(
      (req, index) => requirementAt(req, `${path}.requirements[${index}]`),
    ),
  } as AnnouncementVersion['units'][number];
}

function timelineAt(value: unknown, path: string): AnnouncementVersion['timeline'] {
  const timeline = recordAt(value, path);
  // 时间线字段均为可选字符串/数组；只校验已给出字段的类型，避免臆造
  for (const [key, raw] of Object.entries(timeline)) {
    if (key === 'pendingItems') {
      arrayAt(raw, `${path}.pendingItems`);
      continue;
    }
    if (typeof raw !== 'string')
      fail(`${path}.${key}`, '必须是 YYYY-MM-DD 字符串');
  }
  return timeline as unknown as AnnouncementVersion['timeline'];
}

/**
 * 把一行已发布版本载荷投影为匹配领域对象。
 * 结构异常抛 `ProjectionError`，绝不静默返回空数据。
 */
export function projectCatalogVersion(
  row: CatalogRowInput,
  _now: Date,
): ProjectedCatalogVersion {
  const payload = recordAt(row.payload, 'payload');
  const dataset = enumAt(
    payload.dataset,
    ['test', 'demo', 'real'] as const,
    'payload.dataset',
  );

  const announcementRaw = recordAt(payload.announcement, 'payload.announcement');
  const versionRaw = recordAt(payload.version, 'payload.version');

  const version: AnnouncementVersion = {
    id: stringAt(versionRaw.id, 'payload.version.id'),
    announcementId: stringAt(
      versionRaw.announcementId,
      'payload.version.announcementId',
    ),
    versionNumber: intAt(
      versionRaw.versionNumber,
      'payload.version.versionNumber',
    ),
    sourceKind: enumAt(
      versionRaw.sourceKind,
      SOURCE_KINDS,
      'payload.version.sourceKind',
    ),
    publishedAt: isoAt(versionRaw.publishedAt, 'payload.version.publishedAt'),
    officialSource: evidenceAt(
      versionRaw.officialSource,
      'payload.version.officialSource',
    ),
    timeline: timelineAt(versionRaw.timeline, 'payload.version.timeline'),
    units: arrayAt(versionRaw.units, 'payload.version.units').map((unit, index) =>
      unitAt(unit, `payload.version.units[${index}]`),
    ),
    ...(optionalStringAt(versionRaw.changeNote, 'payload.version.changeNote') !==
    undefined
      ? { changeNote: versionRaw.changeNote as string }
      : {}),
    ...(optionalStringAt(
      versionRaw.supersededAt,
      'payload.version.supersededAt',
    ) !== undefined
      ? { supersededAt: versionRaw.supersededAt as string }
      : {}),
  };

  if (version.announcementId !== row.announcementId) {
    fail(
      'payload.version.announcementId',
      `与数据库行 announcementId=${row.announcementId} 不一致`,
    );
  }

  const payloadLifecycle = announcementRaw.lifecycle;
  const lifecycle =
    row.status === 'withdrawn'
      ? 'withdrawn'
      : payloadLifecycle === 'withdrawn'
        ? 'withdrawn'
        : 'active';

  const announcement: RecruitmentAnnouncement = {
    id: stringAt(announcementRaw.id, 'payload.announcement.id'),
    title: stringAt(announcementRaw.title, 'payload.announcement.title'),
    publisher: stringAt(announcementRaw.publisher, 'payload.announcement.publisher'),
    organizationType: enumAt(
      announcementRaw.organizationType,
      ORGANIZATION_TYPES,
      'payload.announcement.organizationType',
    ),
    officialUrl: stringAt(
      announcementRaw.officialUrl,
      'payload.announcement.officialUrl',
    ),
    subjectScope: arrayAt(
      announcementRaw.subjectScope,
      'payload.announcement.subjectScope',
    ).map((scope, index) =>
      stringAt(scope, `payload.announcement.subjectScope[${index}]`),
    ),
    region: regionAt(announcementRaw.region, 'payload.announcement.region'),
    lifecycle,
    firstPublishedAt: isoAt(
      announcementRaw.firstPublishedAt,
      'payload.announcement.firstPublishedAt',
    ),
    versions: [version],
    dataset: dataset as RecruitmentAnnouncement['dataset'],
    ...(announcementRaw.reviewStatus === 'human_reviewed' ||
    announcementRaw.reviewStatus === 'ai_reviewed_pending'
      ? { reviewStatus: announcementRaw.reviewStatus }
      : {}),
    ...(optionalStringAt(
      announcementRaw.reviewedBy,
      'payload.announcement.reviewedBy',
    ) !== undefined
      ? { reviewedBy: announcementRaw.reviewedBy as string }
      : {}),
    ...(optionalStringAt(
      announcementRaw.reviewedAt,
      'payload.announcement.reviewedAt',
    ) !== undefined
      ? { reviewedAt: announcementRaw.reviewedAt as string }
      : {}),
    ...(isRecord(announcementRaw.sourceHealth)
      ? { sourceHealth: announcementRaw.sourceHealth as never }
      : {}),
    ...(optionalStringAt(
      announcementRaw.contactInfo,
      'payload.announcement.contactInfo',
    ) !== undefined
      ? { contactInfo: announcementRaw.contactInfo as string }
      : {}),
  };

  return { announcement, version };
}
