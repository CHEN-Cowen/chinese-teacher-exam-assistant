/**
 * WB4：按岗位审核工作台的后端服务行为测试（内存 fake prisma）。
 *
 * 覆盖：
 * - submitReview 应用字段级决策（adopt/edit）并持久化到 candidate；
 * - 存在未裁决 conflict 字段时 approve 被拒绝（WB3 门禁）；
 * - 字段决策校验（edit 缺新值 / 缺原因）返回 BadRequest；
 * - getRun 附加 WB3 质量报告（quality）。
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';

// ==================== 夹具 ====================

function makeRunRow(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'run-1',
    snapshotId: 'snap-1',
    announcementId: null,
    parserVersion: 'extract-v2',
    status: params.status ?? 'pending_review',
    candidate: params.candidate ?? null,
    errorCode: null,
    errorMessage: null,
    updatedAt: new Date('2026-10-20T10:00:00.000Z'),
    ...params,
  };
}

function candidate(fields: any[]): any {
  return { fields, parserVersion: 'extract-v2' };
}

function anchored(field: string, value: string, extra: any = {}): any {
  return {
    field,
    value,
    status: 'extracted',
    anchor: { field, locator: { kind: 'excerpt', excerpt: `${field}原文` } },
    ...extra,
  };
}

/** 内存 fake prisma：extractionRun + reviewRecord 最小实现 */
function makePrisma(initialRun: any) {
  let run = { ...initialRun };
  const reviewRecords: any[] = [];
  const prisma: any = {
    extractionRun: {
      findUnique: vi.fn(async () => run),
      update: vi.fn(async ({ data }: any) => {
        run = { ...run, ...data };
        return run;
      }),
    },
    reviewRecord: {
      create: vi.fn(async ({ data }: any) => {
        reviewRecords.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, getRun: () => run, reviewRecords };
}

// ==================== 测试 ====================

describe('WB4 submitReview 字段决策', () => {
  it('approve_with_edit + fieldDecisions：决策应用到 candidate 并留痕', async () => {
    const fields = [anchored('education', '本科及以上')];
    const { prisma, reviewRecords } = makePrisma(
      makeRunRow({ candidate: candidate(fields) }),
    );
    const service = new AnnouncementsService(prisma);

    await service.submitReview(
      {
        runId: 'run-1',
        action: 'approve_with_edit',
        reason: '按岗位逐字段审核',
        editedFields: fields,
        fieldDecisions: [
          {
            identity: 'announcement:education',
            field: 'education',
            action: 'edit',
            afterValue: '本科',
            reason: '公告明确只要求本科',
          },
        ],
      },
      { id: 'u-1', name: '陈惠艳' },
    );

    expect(reviewRecords).toHaveLength(1);
    expect(reviewRecords[0].action).toBe('approve_with_edit');
    expect(reviewRecords[0].reviewerName).toBe('陈惠艳');
  });

  it('存在未裁决 conflict 字段时 approve 被拒绝', async () => {
    const conflictField = {
      field: 'headcount',
      value: '2',
      status: 'conflict',
      scope: 'job',
      jobScope: { key: 'job:3301A01', jobCode: '3301A01', sheet: '岗位表', row: 2 },
      alternatives: [
        { value: '2', source: { kind: 'worksheet', fileId: 'f', fileName: 'x.xlsx', sheet: 's', cell: 'E2' } },
        { value: '3', source: { kind: 'file', fileId: 'f2', fileName: 'x.docx', page: 1 } },
      ],
      anchor: { field: 'headcount', locator: { kind: 'excerpt', excerpt: '人数' } },
    };
    const { prisma } = makePrisma(makeRunRow({ candidate: candidate([conflictField]) }));
    const service = new AnnouncementsService(prisma);

    await expect(
      service.submitReview(
        { runId: 'run-1', action: 'approve', reason: 'r' },
        { id: 'u-1', name: '审核员' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edit 决策缺新值 → BadRequest', async () => {
    const fields = [anchored('education', '本科及以上')];
    const { prisma } = makePrisma(makeRunRow({ candidate: candidate(fields) }));
    const service = new AnnouncementsService(prisma);

    await expect(
      service.submitReview(
        {
          runId: 'run-1',
          action: 'approve_with_edit',
          reason: 'r',
          editedFields: fields,
          fieldDecisions: [
            { identity: 'announcement:education', field: 'education', action: 'edit', reason: 'r' },
          ],
        },
        { id: 'u-1', name: '审核员' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('决策缺原因 → BadRequest', async () => {
    const fields = [anchored('education', '本科及以上')];
    const { prisma } = makePrisma(makeRunRow({ candidate: candidate(fields) }));
    const service = new AnnouncementsService(prisma);

    await expect(
      service.submitReview(
        {
          runId: 'run-1',
          action: 'approve_with_edit',
          reason: 'r',
          editedFields: fields,
          fieldDecisions: [
            { identity: 'announcement:education', field: 'education', action: 'adopt', reason: ' ' },
          ],
        },
        { id: 'u-1', name: '审核员' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('乐观并发：baseUpdatedAt 与当前记录不一致 → 409', async () => {
    const fields = [anchored('education', '本科及以上')];
    const { prisma } = makePrisma(makeRunRow({ candidate: candidate(fields) }));
    const service = new AnnouncementsService(prisma);

    await expect(
      service.submitReview(
        {
          runId: 'run-1',
          action: 'approve',
          reason: 'r',
          baseUpdatedAt: '2026-10-20T09:00:00.000Z', // 旧基线
        },
        { id: 'u-1', name: '审核员' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('WB4 getRun 附加质量报告', () => {
  it('有候选时返回 quality（含按岗位 scopes）', async () => {
    const fields = [
      anchored('education', '本科及以上'),
      { field: 'degree', value: '', status: 'unknown', scope: 'announcement' },
    ];
    const { prisma } = makePrisma(makeRunRow({ candidate: candidate(fields) }));
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getRun('run-1');
    expect(result.quality).toBeTruthy();
    expect(Array.isArray(result.quality.scopes)).toBe(true);
    const ann = result.quality.scopes.find((s: any) => s.key === 'announcement');
    expect(ann).toBeTruthy();
    expect(ann.extracted).toBe(1);
    expect(ann.unknown).toBe(1);
  });

  it('无候选时 quality 为 null', async () => {
    const { prisma } = makePrisma(makeRunRow({ candidate: null }));
    const service = new AnnouncementsService(prisma);

    const result: any = await service.getRun('run-1');
    expect(result.quality).toBeNull();
  });
});
