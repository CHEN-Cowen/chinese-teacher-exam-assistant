/**
 * WB5：目录载荷与发布闭环集成测试。
 *
 * 证明「已审核候选 → publish → 目录载荷 → projector 严格校验 → 事务写入 →
 * PublishedCatalogRepository 读取 → 用户匹配」全链路契约闭合，并守护旧数据兼容。
 *
 * 输入数据全部内联（隔离约束：src/ 不得 import tests/fixtures）。
 */
import {
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';
import { PublishedCatalogRepository } from '../catalog/published-catalog.repository.js';
import { buildCandidates } from '../matching/engine.js';
import type { UserRecruitmentProfile } from '../matching/types.js';
import type { CandidateField, ExtractionCandidate } from './domain.js';

// ==================== 夹具：已审核候选字段 ====================

function anchored(
  field: string,
  value: string,
  scope: 'announcement' | 'job',
  jobKey?: string,
  extra: Partial<CandidateField> = {},
): CandidateField {
  return {
    field,
    value,
    status: 'extracted',
    scope,
    ...(jobKey ? { jobScope: { key: jobKey } } : {}),
    decision: {
      action: 'adopt',
      reason: '审核采纳',
      operatorId: 'reviewer-1',
      decidedAt: '2026-10-20T00:00:00.000Z',
    },
    anchor: { field, locator: { kind: 'excerpt', excerpt: `${field}原文` } },
    origin: 'rule',
    ...extra,
  };
}

/** 两个已审核岗位的候选字段（jobKey 区分） */
function reviewedCandidate(): ExtractionCandidate {
  return {
    fields: [
      anchored('announcement_title', '【测试】示例市教育局2026年教师招聘公告', 'announcement'),
      anchored('region', '浙江省杭州市', 'announcement'),
      anchored('registration_time', '2026-10-20 至 2026-11-05 17:00', 'announcement'),
      // 岗位 A
      anchored('job_code', '3301A01', 'job', 'job-A-3301A01'),
      anchored('unit_name', '示例市第一中学', 'job', 'job-A-3301A01'),
      anchored('stage', '初中', 'job', 'job-A-3301A01'),
      anchored('subject', '语文', 'job', 'job-A-3301A01'),
      anchored('headcount', '2', 'job', 'job-A-3301A01'),
      anchored('major', '汉语言文学（师范）', 'job', 'job-A-3301A01'),
      anchored('education', '本科及以上', 'job', 'job-A-3301A01'),
      anchored('employment_nature', '事业编制', 'job', 'job-A-3301A01'),
      // 岗位 B
      anchored('job_code', '3301A02', 'job', 'job-B-3301A02'),
      anchored('unit_name', '示例市第二中学', 'job', 'job-B-3301A02'),
      anchored('stage', '高中', 'job', 'job-B-3301A02'),
      anchored('subject', '语文', 'job', 'job-B-3301A02'),
      anchored('headcount', '1', 'job', 'job-B-3301A02'),
      anchored('major', '数学与应用数学', 'job', 'job-B-3301A02'),
      anchored('education', '硕士研究生及以上', 'job', 'job-B-3301A02'),
      anchored('employment_nature', '事业编制', 'job', 'job-B-3301A02'),
    ],
    parserVersion: 'extract-v2',
  };
}

// ==================== 内存 fake prisma（可注入失败） ====================

interface FakeState {
  runs: any[];
  versions: any[];
  transactionCalls: number;
  transactionEntered: boolean;
  failTransaction?: Error;
}

function makePrisma(state: FakeState) {
  const prisma: any = {
    extractionRun: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const run = state.runs.find((r) => r.id === where.id);
        if (!run) return null;
        const result: any = { ...run };
        if (include?.publishedVersion) {
          result.publishedVersion =
            state.versions.find((v) => v.runId === run.id && v.status === 'published') ?? null;
        }
        if (include?.snapshot) {
          result.snapshot = run.snapshot ?? null;
        }
        return result;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const run = state.runs.find((r) => r.id === where.id);
        if (!run) throw new Error('run not found');
        Object.assign(run, data);
        return run;
      }),
    },
    publishedAnnouncementVersion: {
      findFirst: vi.fn(async ({ where }: any) => {
        const matched = state.versions.filter(
          (v) => v.announcementId === where.announcementId && v.status === where.status,
        );
        matched.sort((a: any, b: any) => b.versionNumber - a.versionNumber);
        return matched[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return state.versions.find((v) => v.id === where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return state.versions.filter((v) => {
          if (where.status?.in) return where.status.in.includes(v.status);
          if (where.announcementId) return v.announcementId === where.announcementId;
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.versions.find((v) => v.id === where.id);
        if (!row) throw new Error('version not found');
        Object.assign(row, data);
        return row;
      }),
      create: vi.fn(async ({ data }: any) => {
        state.versions.push({ ...data });
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      state.transactionCalls += 1;
      state.transactionEntered = true;
      if (state.failTransaction) throw state.failTransaction;
      return fn(prisma);
    }),
  };
  return prisma;
}

function makeRunRow(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'run-1',
    snapshotId: 'snap-1',
    announcementId: params.announcementId ?? null,
    parserVersion: 'extract-v2',
    status: params.status ?? 'approved',
    candidate: params.candidate ?? reviewedCandidate(),
    submittedBy: params.submittedBy ?? 'reviewer-1',
    snapshot: {
      source: {
        publisher: '示例市教育局',
        officialUrl: 'https://www.example.gov.cn/test/notice',
        regionCode: '330100',
      },
    },
    ...params,
  };
}

const PROFILE: UserRecruitmentProfile = {
  regions: [{ code: '330100', province: '浙江省', city: '杭州市', level: 'required' }],
  educationLevel: 'bachelor',
  degree: 'bachelor',
  majorFullName: '汉语言文学（师范）',
  acceptedEmploymentNatures: ['public_institution_staff'],
};

// ==================== 测试 ====================

describe('S2 正式审核元数据', () => {
  it('real 使用实际审核人和审核时间，不冒用提交人', async () => {
    const run = makeRunRow();
    run.snapshot.source.officialUrl = 'https://edu.hangzhou.gov.cn/notice/test';
    run.submittedBy = 'submitter';
    run.candidate.fields.push(anchored('teacher_cert', '具有相应教师资格', 'announcement'),
      anchored('age', '35周岁及以下', 'announcement'));
    const state: FakeState = { runs: [run], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    prisma.reviewRecord = { findFirst: vi.fn(async () => ({ reviewerId: 'reviewer-real', action: 'approve', reviewedAt: new Date('2026-10-20T01:00:00Z') })) };
    const published = await new AnnouncementsService(prisma).publish('run-1', 'real');
    expect(published.payload.announcement.reviewedBy).toBe('reviewer-real');
    expect(published.payload.announcement.reviewedAt).toBe('2026-10-20T01:00:00.000Z');
    expect(published.payload.dataset).toBe('real');
  });
  it('无通过审核记录时 real 在事务前拒绝', async () => {
    const run = makeRunRow();
    run.snapshot.source.officialUrl = 'https://edu.hangzhou.gov.cn/notice/test';
    const state: FakeState = { runs: [run], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    prisma.reviewRecord = { findFirst: vi.fn(async () => null) };
    await expect(new AnnouncementsService(prisma).publish('run-1', 'real')).rejects.toThrow(/人工通过审核/);
    expect(state.transactionEntered).toBe(false);
  });
});

describe('WB5：发布载荷与 projector 契约闭环', () => {
  it('两个已审核岗位 → 两个 units，projector 成功，repository 可读取', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    const published = await service.publish('run-1', 'test');

    // 新版本 payload 是目录载荷（非 ExtractionCandidate）
    expect(published.payload.dataset).toBe('test');
    expect(published.payload.version.units).toHaveLength(2);
    expect(published.status).toBe('published');

    // repository 能读取并投影
    const repo = new PublishedCatalogRepository(prisma);
    const catalog = await repo.listPublished(new Date());
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('run-1');
    expect(catalog[0].versions[0].units).toHaveLength(2);
  });

  it('普通用户匹配能读取新发布的两个岗位（buildCandidates）', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);
    await service.publish('run-1', 'test');

    const repo = new PublishedCatalogRepository(prisma);
    const catalog = await repo.listPublished(new Date());
    const candidates = buildCandidates(catalog, PROFILE, new Date().toISOString());

    expect(candidates).toHaveLength(2);
    const codes = candidates.map((c) => c.unit.code).sort();
    expect(codes).toEqual(['3301A01', '3301A02']);
  });

  it('第二个岗位字段不混入第一个岗位（major 各自独立）', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);
    const published = await service.publish('run-1', 'test');

    const [a, b] = published.payload.version.units;
    const aMajor = a.requirements.find((r: any) => r.dimension === 'major');
    const bMajor = b.requirements.find((r: any) => r.dimension === 'major');
    expect(aMajor.description).toBe('汉语言文学（师范）');
    expect(bMajor.description).toBe('数学与应用数学');
  });

  it('conflict 字段阻塞发布（WB3 门禁，不进入事务）', async () => {
    const cand = reviewedCandidate();
    cand.fields = cand.fields.map((f) =>
      f.field === 'headcount' && f.scope === 'job' && f.jobScope?.key === 'job-A-3301A01'
        ? {
            ...f,
            status: 'conflict' as const,
            decision: undefined,
            alternatives: [
              { value: '2', source: { kind: 'excerpt' as const, excerpt: 'x' } },
              { value: '3', source: { kind: 'excerpt' as const, excerpt: 'y' } },
            ],
          }
        : f,
    );
    const state: FakeState = { runs: [makeRunRow({ candidate: cand })], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'test')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.transactionEntered).toBe(false);
    expect(state.versions).toHaveLength(0);
  });

  it('AI/OCR 未人工确认阻塞发布', async () => {
    const cand = reviewedCandidate();
    cand.fields = cand.fields.map((f) =>
      f.field === 'major' && f.scope === 'job'
        ? { ...f, origin: 'ai' as const, humanConfirmedAt: undefined }
        : f,
    );
    const state: FakeState = { runs: [makeRunRow({ candidate: cand })], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'test')).rejects.toThrow();
    expect(state.versions).toHaveLength(0);
  });

  it('缺公告元数据不猜值而失败（无 publisher）', async () => {
    const run = makeRunRow();
    run.snapshot.source.publisher = '';
    const state: FakeState = { runs: [run], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'test')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.versions).toHaveLength(0);
  });

  it('学科无法确定时在事务前失败，零数据库写入', async () => {
    const cand = reviewedCandidate();
    const mathSubject = cand.fields.find(
      (f) => f.field === 'subject' && f.scope === 'job' && f.jobScope?.key === 'job-B-3301A02',
    );
    mathSubject!.value = '待确认';
    const state: FakeState = { runs: [makeRunRow({ candidate: cand })], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'test')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.transactionEntered).toBe(false);
    expect(state.versions).toHaveLength(0);
  });

  it('成功发布时 supersede + insert + run update 在同一事务', async () => {
    // 预置一个已发布的旧版本（同公告），发布新版本应 supersede 它
    const oldVersion = {
      id: 'run-1-v1',
      announcementId: 'run-1',
      runId: 'run-0',
      versionNumber: 1,
      status: 'published',
      payload: { dataset: 'test', announcement: { id: 'run-1', title: '旧', publisher: 'x', organizationType: 'government_unified', officialUrl: 'https://www.example.gov.cn/test/notice', subjectScope: ['chinese'], region: { code: '330100', province: '浙江省', city: '杭州市' }, lifecycle: 'active', firstPublishedAt: '2026-10-01T00:00:00.000Z' }, version: { id: 'run-1-v1', announcementId: 'run-1', versionNumber: 1, sourceKind: 'original', publishedAt: '2026-10-01T00:00:00.000Z', officialSource: { id: 'e', locator: { kind: 'url', url: 'https://www.example.gov.cn/test/notice' }, state: 'official', checkedAt: '2026-10-01T00:00:00.000Z' }, timeline: {}, units: [] } },
      publishedAt: new Date('2026-10-01T00:00:00.000Z'),
      previousVersionId: null,
      supersededAt: null,
    };
    const state: FakeState = {
      runs: [makeRunRow({ announcementId: 'run-1' })],
      versions: [oldVersion],
      transactionCalls: 0,
      transactionEntered: false,
    };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    const published = await service.publish('run-1', 'test');

    expect(published.versionNumber).toBe(2);
    expect(state.transactionCalls).toBe(1);
    const supersededRow = state.versions.find((v) => v.id === 'run-1-v1');
    expect(supersededRow.status).toBe('superseded');
    // 新版本插入 + run 状态更新
    expect(state.versions.some((v) => v.versionNumber === 2 && v.status === 'published')).toBe(true);
    expect(state.runs[0].status).toBe('published');
  });

  it('事务内失败时整体回滚（无半成品）', async () => {
    const state: FakeState = {
      runs: [makeRunRow()],
      versions: [],
      transactionCalls: 0,
      transactionEntered: false,
      failTransaction: new Error('db down'),
    };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'test')).rejects.toThrow('db down');
    // 失败发生在事务内，但 create/update 都还没提交（fake 事务直接抛错前未执行）
    expect(state.versions).toHaveLength(0);
    expect(state.runs[0].status).toBe('approved'); // 未被标成 published
  });

  it('重复发布冲突', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await service.publish('run-1', 'test');
    // 第二次发布：run 已有 publishedVersion
    await expect(service.publish('run-1', 'test')).rejects.toBeInstanceOf(ConflictException);
  });

  it('real 数据集要求非演示来源；example.gov.cn 被拒', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);

    await expect(service.publish('run-1', 'real')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.versions).toHaveLength(0);
  });
});

describe('WB5：旧数据兼容', () => {
  it('legacy ExtractionCandidate 行读取不崩溃，投影失败状态明确', async () => {
    // 旧行 payload 是 ExtractionCandidate，projector 会抛 ProjectionError
    const legacyPayload = { fields: [{ field: 'title', value: '旧公告' }], parserVersion: 'v1' };
    const legacyRow = {
      id: 'legacy-1',
      announcementId: 'legacy-ann',
      runId: 'legacy-run',
      versionNumber: 1,
      status: 'published',
      payload: legacyPayload,
      publishedAt: new Date('2026-10-01T00:00:00.000Z'),
      previousVersionId: null,
      supersededAt: null,
    };
    const state: FakeState = { runs: [], versions: [legacyRow], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const repo = new PublishedCatalogRepository(prisma);

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const catalog = await repo.listPublished(new Date());
      // legacy 行无法投影 → 该公告整体跳过，不伪装成合法目录
      expect(catalog).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('新发布行经 PublishedCatalogRepository 后能被 opportunities match 读取（含 dataset 透传）', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);
    await service.publish('run-1', 'test');

    const repo = new PublishedCatalogRepository(prisma);
    const catalog = await repo.listPublished(new Date());
    expect(catalog[0].dataset).toBe('test');
    expect(catalog[0].versions[0].units).toHaveLength(2);
  });

  it('撤回（withdraw）对目录载荷不崩溃，保留历史', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);
    const published = await service.publish('run-1', 'test');

    await service.withdraw('run-1', published.id, { reason: '官方撤回' }, { id: 'admin-1' });

    const row = state.versions.find((v) => v.id === published.id);
    expect(row.status).toBe('withdrawn');
    expect(row.withdrawReason).toBe('官方撤回');
    // payload 未被改写
    expect(row.payload.version.units).toHaveLength(2);
  });

  it('getVersionDiff 对目录载荷不崩溃（返回 unit 差异）', async () => {
    const state: FakeState = { runs: [makeRunRow()], versions: [], transactionCalls: 0, transactionEntered: false };
    const prisma = makePrisma(state);
    const service = new AnnouncementsService(prisma);
    await service.publish('run-1', 'test');

    const diff = await service.getVersionDiff('run-1', 1, 1);
    expect(Array.isArray(diff)).toBe(true);
  });
});

// ==================== R02：真实链路分阶段专业规则 ====================

/** 修改岗位 A 的 major 候选值（模拟审核员结构化确认后的候选） */
function candidateWithMajor(majorValue: string): ExtractionCandidate {
  const candidate = reviewedCandidate();
  const majorA = candidate.fields.find(
    (f) => f.field === 'major' && f.scope === 'job' && f.jobScope?.key === 'job-A-3301A01',
  );
  if (!majorA) throw new Error('夹具缺少岗位 A 的 major 字段');
  majorA.value = majorValue;
  return candidate;
}

function stagedProfile(
  bachelorMajor: string,
  masterMajor?: string,
): UserRecruitmentProfile {
  return {
    regions: [{ code: '330100', province: '浙江省', city: '杭州市', level: 'required' }],
    educationExperiences: [
      {
        id: 'edu-bachelor',
        stage: 'bachelor',
        majorFullName: bachelorMajor,
        status: 'graduated',
        degree: 'bachelor',
        degreeStatus: 'obtained',
        source: 'user',
        majorConfirmed: true,
        teacherTraining: 'yes',
      },
      ...(masterMajor
        ? [{
            id: 'edu-master',
            stage: 'master' as const,
            majorFullName: masterMajor,
            status: 'graduated' as const,
            degree: 'master' as const,
            degreeStatus: 'obtained' as const,
            source: 'user' as const,
            majorConfirmed: true,
            teacherTraining: 'no' as const,
          }]
        : []),
    ],
    acceptedEmploymentNatures: ['public_institution_staff'],
  };
}

/**
 * 候选 → 审核（已采纳决策）→ 发布 → 目录投影 → 用户匹配。
 * 返回目录中岗位 A 的专业条件与用户匹配结论。
 */
async function publishAndMatch(majorValue: string, profile: UserRecruitmentProfile) {
  const state: FakeState = {
    runs: [makeRunRow({ candidate: candidateWithMajor(majorValue) })],
    versions: [],
    transactionCalls: 0,
    transactionEntered: false,
  };
  const prisma = makePrisma(state);
  await new AnnouncementsService(prisma).publish('run-1', 'test');

  const catalog = await new PublishedCatalogRepository(prisma).listPublished(new Date());
  expect(catalog).toHaveLength(1);

  const projectedUnitA = catalog[0]!.versions[0]!.units.find((unit) => unit.code === '3301A01');
  const projectedMajor = projectedUnitA?.requirements.find((req) => req.dimension === 'major');
  expect(projectedMajor?.criterion.kind).toBe('major');

  const candidates = buildCandidates(catalog, profile, '2026-10-28T00:00:00.000Z');
  const unitA = candidates.find((c) => c.unit.code === '3301A01');
  if (!unitA) throw new Error('未生成岗位 A 的匹配候选');
  const majorResult = unitA.match.dimensions.find((d) => d.dimension === 'major');
  if (!majorResult) throw new Error('岗位 A 缺少专业匹配结论');

  return { projectedMajor: projectedMajor!, majorResult };
}

describe('R02：真实发布链路中的分阶段专业规则', () => {
  it('只要求本科：本科专业符合即通过，硕士专业不同不影响', async () => {
    const { projectedMajor, majorResult } = await publishAndMatch(
      '{"names":["汉语言文学"],"stages":["bachelor"]}',
      stagedProfile('汉语言文学', '学科教学（语文）'),
    );
    expect(projectedMajor.criterion).toMatchObject({ stages: ['bachelor'], majorNames: ['汉语言文学'] });
    expect(majorResult.value).toBe('PASS');
    expect(majorResult.adoptedEducation?.[0]).toMatchObject({ stage: 'bachelor', majorFullName: '汉语言文学' });
  });

  it('只要求本科：登记在硕士阶段的同名专业不能替代本科专业', async () => {
    const { majorResult } = await publishAndMatch(
      '{"names":["汉语言文学"],"stages":["bachelor"]}',
      stagedProfile('数学与应用数学', '汉语言文学'),
    );
    expect(majorResult.value).toBe('FAIL');
  });

  it('只要求研究生：硕士专业符合通过，缺硕士阶段资料为 UNKNOWN', async () => {
    const passCase = await publishAndMatch(
      '{"names":["学科教学（语文）"],"stages":["master"]}',
      stagedProfile('汉语言文学', '学科教学（语文）'),
    );
    expect(passCase.majorResult.value).toBe('PASS');

    const unknownCase = await publishAndMatch(
      '{"names":["学科教学（语文）"],"stages":["master"]}',
      stagedProfile('汉语言文学'),
    );
    expect(unknownCase.majorResult.value).toBe('UNKNOWN');
    expect(unknownCase.majorResult.reason).toContain('硕士研究生');
  });

  it('本科或研究生任一满足：任一段命中即 PASS（stageMode=any）', async () => {
    const viaBachelor = await publishAndMatch(
      '{"names":["汉语言文学","学科教学（语文）"],"stages":["bachelor","master"],"stageMode":"any"}',
      stagedProfile('汉语言文学', '数学与应用数学'),
    );
    expect(viaBachelor.projectedMajor.criterion).toMatchObject({ stageMode: 'any' });
    expect(viaBachelor.majorResult.value).toBe('PASS');

    const viaMaster = await publishAndMatch(
      '{"names":["汉语言文学","学科教学（语文）"],"stages":["bachelor","master"],"stageMode":"any"}',
      stagedProfile('数学与应用数学', '学科教学（语文）'),
    );
    expect(viaMaster.majorResult.value).toBe('PASS');
  });

  it('本科和研究生同时满足：任一段不符即 FAIL（stageMode=all）', async () => {
    const failCase = await publishAndMatch(
      '{"names":["汉语言文学"],"stages":["bachelor","master"],"stageMode":"all"}',
      stagedProfile('汉语言文学', '数学与应用数学'),
    );
    expect(failCase.projectedMajor.criterion).toMatchObject({ stageMode: 'all' });
    expect(failCase.majorResult.value).toBe('FAIL');

    const passCase = await publishAndMatch(
      '{"names":["汉语言文学"],"stages":["bachelor","master"],"stageMode":"all"}',
      stagedProfile('汉语言文学', '汉语言文学'),
    );
    expect(passCase.majorResult.value).toBe('PASS');
  });

  it('未明确阶段：发布版本不带 stages，不自动当成最高学历阶段要求', async () => {
    const { projectedMajor, majorResult } = await publishAndMatch(
      '汉语言文学',
      stagedProfile('汉语言文学', '学科教学（语文）'),
    );
    // 数据层：旧格式文本没有被自动补上 stages/stageMode
    expect(projectedMajor.criterion).toEqual({ kind: 'major', majorNames: ['汉语言文学'] });
    // 匹配仍返回明确结论（阶段歧义的语义修正由 R03 覆盖），不崩溃、不静默
    expect(['PASS', 'FAIL', 'UNKNOWN', 'MANUAL_REVIEW']).toContain(majorResult.value);
  });
});
