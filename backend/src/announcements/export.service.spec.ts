/**
 * WB6：审核导出服务与权限测试（内存 fake prisma）。
 *
 * 覆盖：
 * - 导出基于服务端已保存记录（run.candidate + reviewRecords + snapshot.source）；
 * - 空 run（无候选）返回明确错误而非空成功文件；
 * - run 不存在 → 404；
 * - datasetMark 来自已发布目录载荷；
 * - 导出端点复用管理员权限（AdminGuard 路由元数据）；
 * - 未授权角色被 AdminGuard 拒绝。
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExportService } from './export.service.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AdminGuard } from '../auth/admin.guard.js';
import type { ExtractionCandidate } from './domain.js';

// ==================== 夹具 ====================

function goldenLikeCandidate(): ExtractionCandidate {
  return {
    fields: [
      {
        field: 'region',
        value: '杭州市',
        status: 'extracted',
        scope: 'announcement',
        ruleVersion: 'wb-golden@1.0.0',
        origin: 'rule',
        anchor: { field: 'region', locator: { kind: 'excerpt', excerpt: '杭州市' } },
      },
      {
        field: 'major',
        value: '汉语言文学（师范）',
        status: 'extracted',
        scope: 'job',
        jobScope: { key: 'job-A-3301A01' },
        ruleVersion: 'wb-golden@1.0.0',
        origin: 'rule',
        anchor: { field: 'major', locator: { kind: 'excerpt', excerpt: '汉语言文学（师范）' } },
        decision: {
          action: 'adopt',
          beforeValue: '汉语言文学（师范）',
          afterValue: '汉语言文学（师范）',
          reason: '与岗位表原文一致',
          operatorId: 'reviewer-1',
          decidedAt: '2026-10-20T00:00:00.000Z',
        },
      },
    ],
    parserVersion: 'wb-golden@1.0.0',
  };
}

function makeRunRow(params: Partial<any> = {}): any {
  return {
    id: params.id ?? 'run-1',
    snapshotId: 'snap-1',
    announcementId: null,
    parserVersion: 'wb-golden@1.0.0',
    status: params.status ?? 'approved',
    candidate: params.candidate ?? goldenLikeCandidate(),
    retryCount: params.retryCount ?? 0,
    createdAt: new Date('2026-10-20T01:00:00.000Z'),
    updatedAt: new Date('2026-10-20T02:00:00.000Z'),
    finishedAt: params.finishedAt ?? new Date('2026-10-20T02:00:00.000Z'),
    snapshot: {
      id: 'snap-1',
      source: {
        publisher: '示例市教育局（测试）',
        officialUrl: 'https://www.example.gov.cn/test/wb-notice',
        regionCode: '330100',
      },
    },
    reviewRecords: params.reviewRecords ?? [
      {
        action: 'approve_with_edit',
        reason: '已逐字段核对公告原文',
        reviewerId: 'reviewer-1',
        reviewerName: '测试审核员',
        reviewedAt: new Date('2026-10-20T01:30:00.000Z'),
      },
    ],
    publishedVersion: params.publishedVersion ?? null,
    ...params,
  };
}

function makePrisma(initialRuns: any[]) {
  const runs = initialRuns.map((r) => ({ ...r }));
  const prisma: any = {
    extractionRun: {
      findUnique: vi.fn(async ({ where }: any) => {
        const run = runs.find((r) => r.id === where.id);
        if (!run) return null;
        return {
          ...run,
          reviewRecords: run.reviewRecords ?? [],
          publishedVersion: run.publishedVersion ?? null,
        };
      }),
    },
  };
  return { prisma, runs };
}

// ==================== 导出服务 ====================

describe('ExportService', () => {
  it('JSON 导出基于服务端已保存记录（含真实审核记录与决策原因）', async () => {
    const { prisma } = makePrisma([makeRunRow()]);
    const service = new ExportService(prisma);

    const { body, filename } = await service.exportJson('run-1');

    expect(filename).toBe('workbuddy-run-run-1.json');
    const json = JSON.parse(body);
    expect(json.schemaVersion).toBe('wb-export@1.0.0');
    expect(json.run.id).toBe('run-1');
    // human_revision 与 reason 来自真实审核记录
    const major = json.candidate.fields.find((f: any) => f.field === 'major');
    expect(major.decision.action).toBe('adopt');
    expect(major.decision.reason).toBe('与岗位表原文一致');
    expect(json.reviewRecords[0].reason).toBe('已逐字段核对公告原文');
    // 来源 URL 脱敏说明与列顺序齐备
    expect(json.csvColumnOrder).toContain('human_revision');
    expect(json.notes.length).toBeGreaterThan(0);
  });

  it('CSV 导出：14 列表头 + 一行一个岗位字段', async () => {
    const { prisma } = makePrisma([makeRunRow()]);
    const service = new ExportService(prisma);

    const { body, filename } = await service.exportCsv('run-1');

    expect(filename).toBe('workbuddy-run-run-1.csv');
    const lines = body.replace('\uFEFF', '').split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'sample_id,job_id,field,value,source_file,quote,locator,status,scope,rule_version,run_id,human_revision,reason,alternatives',
    );
    expect(lines).toHaveLength(3); // 表头 + 2 个字段行
    const majorLine = lines.find((l) => l.includes('汉语言文学'));
    expect(majorLine).toContain('job-A-3301A01');
    expect(majorLine).toContain('adopt');
  });

  it('实测指标端点：datasetMark 来自已发布目录载荷', async () => {
    const { prisma } = makePrisma([
      makeRunRow({
        status: 'published',
        publishedVersion: {
          id: 'v1',
          payload: {
            dataset: 'test',
            announcement: { id: 'a' },
            version: { id: 'v' },
          },
        },
      }),
    ]);
    const service = new ExportService(prisma);

    const metrics = await service.getMetrics('run-1');

    expect(metrics.datasetMark).toBe('test');
    expect(metrics.sourceHost).toBe('www.example.gov.cn');
    expect(metrics.isExampleSource).toBe(true);
    expect(metrics.totals.expected).toBe(2);
    expect(metrics.totals.extracted).toBe(2);
  });

  it('空 run（无候选结果）→ 明确 BadRequest，绝不生成空文件', async () => {
    const { prisma } = makePrisma([makeRunRow({ candidate: null })]);
    const service = new ExportService(prisma);

    await expect(service.exportJson('run-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.exportCsv('run-1')).rejects.toThrow(
      '该任务还没有提取结果，无法导出',
    );
    await expect(service.getMetrics('run-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('run 不存在 → 404', async () => {
    const { prisma } = makePrisma([]);
    const service = new ExportService(prisma);

    await expect(service.exportJson('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.exportCsv('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ==================== 权限：路由守卫与未授权拒绝 ====================

describe('导出端点权限（AdminGuard）', () => {
  it('三个导出端点都挂 AdminGuard（复用管理员权限）', () => {
    // Nest @UseGuards 把守卫写入方法元数据 __guards__（reflect-metadata）
    const guardsOf = (method: string) =>
      Reflect.getMetadata(
        '__guards__',
        AnnouncementsController.prototype,
        method,
      ) as unknown[] | undefined;

    expect(guardsOf('exportRunJson')).toContain(AdminGuard);
    expect(guardsOf('exportRunCsv')).toContain(AdminGuard);
    expect(guardsOf('getExportMetrics')).toContain(AdminGuard);
  });

  it('未授权角色（非后台角色）被 AdminGuard 拒绝', () => {
    const guard = new AdminGuard();
    const fakeContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          // demo 模式从请求头解析身份；普通用户 role=invited_user
          headers: {
            'x-user-id': 'user-1',
            'x-user-role': 'invited_user',
          },
        }),
      }),
    };
    expect(() =>
      guard.canActivate(fakeContext as never),
    ).toThrow(ForbiddenException);
  });
});
