/**
 * v7.2 AnnouncementsService 撤回与投影状态查询测试（内存 fake prisma）。
 *
 * 覆盖：
 * - withdraw：事务写入撤回三字段 + 操作人；版本归属校验；非 published 拒绝；
 * - getProjectionStatus：not_published / projected / failed（含 fieldPath）三态。
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';

describe('审核原件读取与抓取存储契约', () => {
  function context(mimeType = 'text/html') {
    const prisma = {
      sourceSnapshot: { findUnique: vi.fn(async () => ({ id: 'snap-read', storageKey: 'snapshots/ab/abcdef', contentHash: 'abcdef', mimeType })) },
      documentParseRun: { findFirst: vi.fn(async () => ({ blocks: [{ text: '岗位表原文' }] })) },
    };
    const store = { getBinary: vi.fn(async () => Buffer.from('已归档正文')) };
    const service = new AnnouncementsService(prisma as never, undefined, undefined, store as never);
    return { service, store, prisma };
  }
  it('按数据库storageKey读取自动抓取正文，不猜hash.bin路径', async () => {
    const { service, store } = context();
    expect(await service.getSnapshotContent('snap-read')).toEqual({ content: '已归档正文', mimeType: 'text/html' });
    expect(store.getBinary).toHaveBeenCalledWith('snapshots/ab/abcdef');
  });
  it('附件展示同一快照解析文本，不解码二进制原件', async () => {
    const { service, store, prisma } = context('application/pdf');
    store.getBinary.mockResolvedValue(Buffer.from([0xff, 0x00, 0x80]));
    const result = await service.getSnapshotContent('snap-read');
    expect(result.content).toContain('同一归档快照的解析文本');
    expect(result.content).toContain('岗位表原文');
    expect(prisma.documentParseRun.findFirst).toHaveBeenCalledWith({ where: { snapshotId: 'snap-read' }, orderBy: { createdAt: 'desc' } });
  });
  it('存储权限错误不误报丢失，不要求用户重新上传', async () => {
    const { service, store } = context();
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    store.getBinary.mockRejectedValue(error);
    await expect(service.getSnapshotContent('snap-read')).rejects.toBe(error);
  });
  it('真正缺失时明确要求检查历史归档，不以重新抓取覆盖证据', async () => {
    const { service, store } = context();
    store.getBinary.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(service.getSnapshotContent('snap-read')).rejects.toThrow('历史证据');
  });
});

// ==================== 夹具 ====================

/** 合法目录载荷（与 published-catalog.repository.spec.ts 内联样本同构） */
function catalogPayload(announcementId: string): any {
  return {
    dataset: 'test',
    announcement: {
      id: announcementId,
      title: '【测试】撤回与投影',
      publisher: '测试市教育局',
      organizationType: 'government_unified',
      officialUrl: 'https://www.example.gov.cn/test/notice',
      subjectScope: ['chinese'],
      region: { code: '330100', province: '浙江省', city: '杭州市' },
      lifecycle: 'active',
      firstPublishedAt: '2026-10-10T00:00:00.000Z',
    },
    version: {
      id: `${announcementId}-v1`,
      announcementId,
      versionNumber: 1,
      sourceKind: 'original',
      publishedAt: '2026-10-10T02:00:00.000Z',
      officialSource: {
        id: 'fx-evidence-official',
        locator: { kind: 'url', url: 'https://www.example.gov.cn/test/notice' },
        state: 'official',
        checkedAt: '2026-10-10T00:00:00.000Z',
      },
      timeline: { registrationStart: '2026-10-10', registrationEnd: '2026-11-20' },
      units: [
        {
          id: 'fx-unit-1',
          code: 'FX-01',
          name: '测试学校（初中语文）',
          announcementId,
          versionId: `${announcementId}-v1`,
          region: { code: '330107', province: '浙江省', city: '杭州市' },
          subject: 'chinese',
          stage: 'middle',
          headcount: 2,
          organizationType: 'government_unified',
          employmentNature: {
            code: 'public_institution_staff',
            officialName: '事业编制（测试）',
          },
          allocation: { code: 'unified_assignment', description: '测试分配' },
          requirements: [],
        },
      ],
    },
  };
}

function makeVersionRow(params: Partial<any> = {}): any {
  const announcementId = params.announcementId ?? 'ann-1';
  return {
    id: params.id ?? `${announcementId}-v1`,
    announcementId,
    runId: 'run-1',
    versionNumber: params.versionNumber ?? 1,
    status: params.status ?? 'published',
    payload: params.payload ?? catalogPayload(announcementId),
    publishedAt: params.publishedAt ?? new Date('2026-10-10T02:00:00.000Z'),
    previousVersionId: null,
    supersededAt: null,
    withdrawnAt: null,
    withdrawReason: null,
    withdrawnBy: null,
  };
}

/** 内存 fake prisma：支持 findUnique/findFirst/update/$transaction */
function makePrisma(initialRows: any[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const updates: Array<{ where: any; data: any }> = [];
  const prisma: any = {
    publishedAnnouncementVersion: {
      findUnique: vi.fn(async ({ where }: any) => {
        return rows.find((row) => row.id === where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const matched = rows.filter(
          (row) =>
            row.announcementId === where.announcementId &&
            row.status === where.status,
        );
        matched.sort((a, b) => b.versionNumber - a.versionNumber);
        return matched[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updates.push({ where, data });
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('row not found');
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, rows, updates };
}

// ==================== withdraw ====================

describe('AnnouncementsService.withdraw', () => {
  it('published 版本撤回成功：事务写入 status/三字段/操作人', async () => {
    const { prisma, updates } = makePrisma([makeVersionRow()]);
    const service = new AnnouncementsService(prisma);

    const result = await service.withdraw(
      'ann-1',
      'ann-1-v1',
      { reason: '官方已撤回该公告' },
      { id: 'reviewer-9' },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: 'ann-1-v1' });
    expect(updates[0].data.status).toBe('withdrawn');
    expect(updates[0].data.withdrawReason).toBe('官方已撤回该公告');
    expect(updates[0].data.withdrawnBy).toBe('reviewer-9');
    expect(updates[0].data.withdrawnAt).toBeInstanceOf(Date);
    expect(updates[0].data.supersededAt).toBeInstanceOf(Date);
    expect(result.status).toBe('withdrawn');
    // payload 不被改写
    expect(result.payload).toEqual(catalogPayload('ann-1'));
  });

  it('版本不属于该公告 → NotFound', async () => {
    const { prisma } = makePrisma([makeVersionRow()]);
    const service = new AnnouncementsService(prisma);

    await expect(
      service.withdraw('ann-other', 'ann-1-v1', { reason: 'x' }, { id: 'r' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('版本不存在 → NotFound', async () => {
    const { prisma } = makePrisma([]);
    const service = new AnnouncementsService(prisma);

    await expect(
      service.withdraw('ann-1', 'missing', { reason: 'x' }, { id: 'r' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('非 published 版本（superseded）撤回 → BadRequest，且不写库', async () => {
    const { prisma, updates } = makePrisma([
      makeVersionRow({ status: 'superseded' }),
    ]);
    const service = new AnnouncementsService(prisma);

    await expect(
      service.withdraw('ann-1', 'ann-1-v1', { reason: 'x' }, { id: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('空原因 → BadRequest，且不写库', async () => {
    const { prisma, updates } = makePrisma([makeVersionRow()]);
    const service = new AnnouncementsService(prisma);

    await expect(
      service.withdraw('ann-1', 'ann-1-v1', { reason: '  ' }, { id: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('撤回不删除行、不产生新版本、旧版保持 superseded', async () => {
    const oldRow = makeVersionRow({
      id: 'ann-1-v0',
      versionNumber: 0,
      status: 'superseded',
    });
    const { prisma, rows, updates } = makePrisma([oldRow, makeVersionRow()]);
    const service = new AnnouncementsService(prisma);

    await service.withdraw('ann-1', 'ann-1-v1', { reason: '官方撤回' }, { id: 'r' });

    expect(rows).toHaveLength(2); // 无删除、无新增
    expect(updates).toHaveLength(1); // 只更新当前行
    expect(rows[0].status).toBe('superseded'); // 旧版未被复活
    expect(rows[0].withdrawnAt).toBeNull();
  });
});

// ==================== getProjectionStatus ====================

describe('AnnouncementsService.getProjectionStatus', () => {
  it('无 published 版本 → not_published', async () => {
    const { prisma } = makePrisma([]);
    const service = new AnnouncementsService(prisma);

    await expect(service.getProjectionStatus('ann-1')).resolves.toEqual({
      status: 'not_published',
    });
  });

  it('合法版本 → projected（含 unitCount 与 versionNumber）', async () => {
    const { prisma } = makePrisma([makeVersionRow()]);
    const service = new AnnouncementsService(prisma);

    await expect(service.getProjectionStatus('ann-1')).resolves.toEqual({
      status: 'projected',
      unitCount: 1,
      versionNumber: 1,
    });
  });

  it('结构损坏版本 → failed（含 fieldPath 与 message，不含 payload）', async () => {
    const broken = catalogPayload('ann-1');
    delete broken.version.units[0].headcount;
    const { prisma } = makePrisma([makeVersionRow({ payload: broken })]);
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getProjectionStatus('ann-1');

    expect(result.status).toBe('failed');
    expect(result.fieldPath).toBe('payload.version.units[0].headcount');
    expect(typeof result.message).toBe('string');
    expect(result.versionNumber).toBe(1);
    expect(JSON.stringify(result)).not.toContain('测试学校');
  });
});

// ==================== getSnapshotParsed ====================

/** 内存 fake prisma：快照 / 解析记录 / 逻辑文档三张表 */
function makeParsePrisma(input: {
  snapshots?: any[];
  parseRuns?: any[];
  documents?: any[];
}) {
  const snapshots = (input.snapshots ?? []).map((row) => ({ ...row }));
  const parseRuns = (input.parseRuns ?? []).map((row) => ({ ...row }));
  const documents = (input.documents ?? []).map((row) => ({ ...row }));
  const prisma: any = {
    sourceSnapshot: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const row = snapshots.find((s) => s.id === where.id) ?? null;
        if (!row) return null;
        if (select?.fetchedAt) return { fetchedAt: row.fetchedAt };
        return row;
      }),
    },
    documentParseRun: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const matched = parseRuns
          .filter((run) => {
            if (where.documentId !== undefined && run.documentId !== where.documentId) return false;
            if (typeof where.snapshotId === 'string' && run.snapshotId !== where.snapshotId) return false;
            if (where.snapshotId?.not !== undefined && run.snapshotId === where.snapshotId.not) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const first = matched[0] ?? null;
        if (!first) return null;
        if (select?.snapshotId) return { snapshotId: first.snapshotId };
        return first;
      }),
    },
    sourceDocument: {
      findFirst: vi.fn(async ({ where }: any) => {
        const doc = documents.find((d) => d.latestSnapshotId === where.latestSnapshotId) ?? null;
        return doc ? { id: doc.id } : null;
      }),
    },
  };
  return { prisma };
}

function makeSnapshotRow(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'snap-1',
    sourceId: 'source-1',
    fetchedAt: params.fetchedAt ?? new Date('2026-10-12T08:00:00.000Z'),
  };
}

function makeParseRunRow(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'pr-1',
    snapshotId: params.snapshotId ?? 'snap-1',
    documentId: params.documentId ?? 'doc-1',
    format: params.format ?? 'pdf',
    parserVersion: params.parserVersion ?? 'pdf@wp5-v1',
    status: params.status ?? 'parsed',
    blocks: params.blocks ?? [{ kind: 'paragraph', text: '正文' }],
    tableHeaders: params.tableHeaders ?? null,
    warnings: params.warnings ?? ['PDF 第 2 页为扫描件'],
    warningCount: params.warningCount ?? 1,
    scanned: params.scanned ?? true,
    ocrRequired: params.ocrRequired ?? true,
    ocrStatus: params.ocrStatus ?? 'completed',
    createdAt: params.createdAt ?? new Date('2026-10-12T08:05:00.000Z'),
    finishedAt: params.finishedAt ?? new Date('2026-10-12T08:06:00.000Z'),
  };
}

describe('AnnouncementsService.getSnapshotParsed', () => {
  it('快照不存在 → NotFound', async () => {
    const { prisma } = makeParsePrisma({});
    const service = new AnnouncementsService(prisma);

    await expect(service.getSnapshotParsed('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('无解析记录 → parseRun 为 null 且无来源变化', async () => {
    const { prisma } = makeParsePrisma({ snapshots: [makeSnapshotRow()] });
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getSnapshotParsed('snap-1');

    expect(result.parseRun).toBeNull();
    expect(result.change.hasPreviousSnapshot).toBe(false);
    expect(result.change.currentFetchedAt).toBe('2026-10-12T08:00:00.000Z');
  });

  it('有解析记录 → 字段完整映射（警告/扫描/OCR/完成时间）', async () => {
    const { prisma } = makeParsePrisma({
      snapshots: [makeSnapshotRow()],
      parseRuns: [makeParseRunRow()],
    });
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getSnapshotParsed('snap-1');

    expect(result.parseRun.format).toBe('pdf');
    expect(result.parseRun.parserVersion).toBe('pdf@wp5-v1');
    expect(result.parseRun.warnings).toEqual(['PDF 第 2 页为扫描件']);
    expect(result.parseRun.scanned).toBe(true);
    expect(result.parseRun.ocrStatus).toBe('completed');
    expect(result.parseRun.finishedAt).toBe('2026-10-12T08:06:00.000Z');
    // 同文档无其他快照 → 无来源变化
    expect(result.change.hasPreviousSnapshot).toBe(false);
  });

  it('同文档存在更早快照 → 来源变化提示含上次抓取时间', async () => {
    const { prisma } = makeParsePrisma({
      snapshots: [
        makeSnapshotRow(),
        makeSnapshotRow({ id: 'snap-0', fetchedAt: new Date('2026-10-11T08:00:00.000Z') }),
      ],
      parseRuns: [
        makeParseRunRow(),
        makeParseRunRow({
          id: 'pr-0',
          snapshotId: 'snap-0',
          createdAt: new Date('2026-10-11T08:05:00.000Z'),
        }),
      ],
    });
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getSnapshotParsed('snap-1');

    expect(result.change.hasPreviousSnapshot).toBe(true);
    expect(result.change.previousFetchedAt).toBe('2026-10-11T08:00:00.000Z');
  });

  it('解析记录缺 documentId 时经 latestSnapshotId 回查文档', async () => {
    const { prisma } = makeParsePrisma({
      snapshots: [makeSnapshotRow()],
      parseRuns: [makeParseRunRow({ documentId: null })],
      documents: [{ id: 'doc-via-latest', latestSnapshotId: 'snap-1' }],
    });
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getSnapshotParsed('snap-1');

    // 回查到文档但无其他快照 → 仍无来源变化，且不报错
    expect(result.parseRun.id).toBe('pr-1');
    expect(result.change.hasPreviousSnapshot).toBe(false);
  });
});

// ==================== 跨阶段流水线汇总（D09 / U10） ====================

describe('AnnouncementsService.pipelineSummary', () => {
  function makeSummaryPrisma(data: {
    sourceTotal?: number;
    sourceHealth?: Array<{ healthStatus: string; count: number }>;
    lastSuccessAt?: Date | null;
    snapshotTotal?: number;
    snapshotLast24h?: number;
    parseStatus?: Array<{ status: string; count: number }>;
    extractionStatus?: Array<{ status: string; count: number }>;
    publishedStatus?: Array<{ status: string; count: number }>;
    lastPublishedAt?: Date | null;
  }) {
    const groupBy = (rows: Array<{ status?: string; healthStatus?: string; count: number }>) =>
      vi.fn(async () => rows.map((r) => ({ ...r, _count: r.count })));
    return {
      source: {
        count: vi.fn(async () => data.sourceTotal ?? 0),
        groupBy: groupBy((data.sourceHealth ?? []).map((r) => ({ healthStatus: r.healthStatus, count: r.count }))),
        findFirst: vi.fn(async () =>
          data.lastSuccessAt ? { lastSuccessAt: data.lastSuccessAt } : null,
        ),
      },
      sourceSnapshot: {
        count: vi
          .fn()
          .mockResolvedValueOnce(data.snapshotTotal ?? 0)
          .mockResolvedValueOnce(data.snapshotLast24h ?? 0),
      },
      documentParseRun: {
        groupBy: groupBy((data.parseStatus ?? []).map((r) => ({ status: r.status, count: r.count }))),
      },
      extractionRun: {
        groupBy: groupBy((data.extractionStatus ?? []).map((r) => ({ status: r.status, count: r.count }))),
      },
      publishedAnnouncementVersion: {
        groupBy: groupBy((data.publishedStatus ?? []).map((r) => ({ status: r.status, count: r.count }))),
        findFirst: vi.fn(async () =>
          data.lastPublishedAt ? { publishedAt: data.lastPublishedAt } : null,
        ),
      },
    } as any;
  }

  it('汇总各阶段真实计数与最新时间；空库时全为 0/null', async () => {
    const empty = new AnnouncementsService(makeSummaryPrisma({}));
    const emptyResult: any = await empty.pipelineSummary();
    expect(emptyResult.sources.total).toBe(0);
    expect(emptyResult.sources.byHealthStatus).toEqual({});
    expect(emptyResult.sources.lastSuccessAt).toBeNull();
    expect(emptyResult.snapshots.total).toBe(0);
    expect(emptyResult.snapshots.last24h).toBe(0);
    expect(emptyResult.parseRuns.byStatus).toEqual({});
    expect(emptyResult.extractionRuns.byStatus).toEqual({});
    expect(emptyResult.publishedVersions.byStatus).toEqual({});
    expect(emptyResult.publishedVersions.lastPublishedAt).toBeNull();
    expect(typeof emptyResult.generatedAt).toBe('string');

    const now = new Date('2026-10-28T10:00:00Z');
    const populated = new AnnouncementsService(
      makeSummaryPrisma({
        sourceTotal: 11,
        sourceHealth: [
          { healthStatus: 'healthy', count: 9 },
          { healthStatus: 'degraded', count: 2 },
        ],
        lastSuccessAt: now,
        snapshotTotal: 42,
        snapshotLast24h: 3,
        parseStatus: [
          { status: 'parsed', count: 30 },
          { status: 'pending_manual', count: 5 },
          { status: 'failed', count: 2 },
        ],
        extractionStatus: [
          { status: 'pending_review', count: 4 },
          { status: 'published', count: 12 },
          { status: 'failed', count: 1 },
        ],
        publishedStatus: [
          { status: 'published', count: 9 },
          { status: 'superseded', count: 3 },
        ],
        lastPublishedAt: now,
      }),
    );
    const result: any = await populated.pipelineSummary();
    expect(result.sources).toEqual({
      total: 11,
      byHealthStatus: { healthy: 9, degraded: 2 },
      lastSuccessAt: now.toISOString(),
    });
    expect(result.snapshots).toEqual({ total: 42, last24h: 3 });
    expect(result.parseRuns.byStatus).toEqual({
      parsed: 30,
      pending_manual: 5,
      failed: 2,
    });
    expect(result.extractionRuns.byStatus).toEqual({
      pending_review: 4,
      published: 12,
      failed: 1,
    });
    expect(result.publishedVersions.byStatus).toEqual({
      published: 9,
      superseded: 3,
    });
    expect(result.publishedVersions.lastPublishedAt).toBe(now.toISOString());
  });
});
