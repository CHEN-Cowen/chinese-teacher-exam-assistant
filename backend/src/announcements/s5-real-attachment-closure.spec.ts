/**
 * S5 任务 4：真实附件进入既有审核发布链路。
 *
 * 输入是官方原件，固定在 tests/fixtures/real-attachments，不覆盖黄金样本：
 * - 宁波岗位表 xlsx（1,682,093 字节，sha256 5edcbe86370a…）
 * - 南京核减表 xls（33,280 字节，sha256 749f8eba21c5…）
 *
 * FakePrisma 只证明代码链路。它不是正式 PostgreSQL，不能据此声称正式库验收通过。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import { DocumentParserService } from '../document-processing/document-parser.service.js';
import { PublishedCatalogRepository } from '../catalog/published-catalog.repository.js';
import {
  fieldIdentity,
  materialPackKey,
  type CandidateField,
  type ExtractionCandidate,
} from './domain.js';
import { ManualExtractionService } from './manual-extraction.service.js';
import { FakeObjectStore, FakePrisma } from '../sourcing/testing/crawl-testing.js';

const attachmentsRoot = path.resolve(import.meta.dirname, '../../../tests/fixtures/real-attachments');
const ningboHtml = readFileSync(
  path.resolve(import.meta.dirname, '../../../tests/fixtures/golden-sources/ningbo/public-detail.html'),
  'utf8',
);
const ningboXlsx = readFileSync(path.join(attachmentsRoot, 'ningbo-att-1.xlsx'));
const nanjingXls = readFileSync(path.join(attachmentsRoot, 'nanjing-correction-1.xls'));
const ningboUrl =
  'https://jyj.ningbo.gov.cn/col/col1229166692/art/2026/art_c58c701a5e034741ab977dfe7f771545.html';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function attachReviewStore(prisma: FakePrisma) {
  prisma.reviewRecords = [];
  prisma.reviewRecord = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `rr-${prisma.reviewRecords.length + 1}`,
        reviewedAt: new Date(),
        ...data,
      };
      prisma.reviewRecords.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: { runId: string } }) =>
      [...prisma.reviewRecords].reverse().find((row) => row.runId === where.runId) ?? null,
  };
}

function serviceFor(prisma: FakePrisma, store: FakeObjectStore) {
  return new ManualExtractionService(
    prisma as never,
    new DocumentParserService(),
    new DocumentParseStore(prisma as never),
    store,
  );
}

describe('S5 真实附件闭环', () => {
  it('xlsx 岗位表与 xls 更正表进入材料包，冲突未裁决时不能审核通过', async () => {
    expect(sha256(ningboXlsx).startsWith('5edcbe86370a')).toBe(true);
    expect(sha256(nanjingXls).startsWith('749f8eba21c5')).toBe(true);
    expect(ningboXlsx.subarray(0, 2).toString('hex')).toBe('504b');
    expect(nanjingXls.subarray(0, 4).toString('hex')).toBe('d0cf11e0');

    const prisma = new FakePrisma();
    const store = new FakeObjectStore();
    attachReviewStore(prisma);
    const submitted = await serviceFor(prisma, store).submitSource(
      {
        publisher: '宁波市教育局',
        officialUrl: ningboUrl,
        regionCode: '330200',
        sourceType: 'manual_text',
        content: ningboHtml,
        mimeType: 'text/html',
        attachments: [
          {
            name: '招聘单位岗位学历专业及资格条件表.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            bytes: ningboXlsx,
          },
          {
            name: '南京核减计划情况表.xls',
            mimeType: 'application/vnd.ms-excel',
            bytes: nanjingXls,
          },
        ],
      },
      's5-task4',
    );
    const first = submitted.run as { id: string; materialFingerprint: string };
    expect(first.materialFingerprint).toBeTruthy();

    const again = await serviceFor(prisma, store).submitSource(
      {
        publisher: '宁波市教育局',
        officialUrl: ningboUrl,
        sourceType: 'manual_text',
        content: ningboHtml,
        mimeType: 'text/html',
        attachments: [
          {
            name: '招聘单位岗位学历专业及资格条件表.xlsx',
            bytes: ningboXlsx,
          },
        ],
      },
      's5-task4',
    );
    const second = again.run as { id: string; materialFingerprint: string };
    expect(second.id).not.toBe(first.id);
    expect(second.materialFingerprint).not.toBe(first.materialFingerprint);
    expect(materialPackKey(sha256(Buffer.from(ningboHtml)), [])).not.toBe(first.materialFingerprint);

    const outcome = await serviceFor(prisma, store).runExtraction(first.id);
    expect(outcome.files.map((file) => file.readStatus)).toEqual(['ok', 'ok', 'ok']);
    expect(outcome.files.map((file) => file.format)).toEqual(['html', 'spreadsheet', 'spreadsheet']);
    const saved = prisma.extractionRuns.find((row) => row.id === first.id)!;
    const candidate = saved.candidate as ExtractionCandidate;
    expect(candidate.rawJson).toHaveProperty('reconciliation');
    const conflicts = candidate.fields.filter((field) => field.status === 'conflict');
    expect(conflicts.length).toBeGreaterThan(0);

    const announcements = new AnnouncementsService(prisma as never);
    await expect(
      announcements.submitReview(
        {
          runId: first.id,
          action: 'approve',
          reason: '试图跳过冲突裁决',
          fieldDecisions: [],
        },
        { id: 'reviewer-1', name: '审核员' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.extractionRuns.find((row) => row.id === first.id)!.status).toBe('pending_review');

    const decided = await announcements.submitReview(
      {
        runId: first.id,
        action: 'approve',
        reason: '冲突按原值采纳，非冲突字段一并确认',
        fieldDecisions: candidate.fields.map((field) => ({
          identity: fieldIdentity(field),
          field: field.field,
          action: 'adopt' as const,
          reason: '按当前候选原值确认',
        })),
      },
      { id: 'reviewer-1', name: '审核员' },
    );
    expect(decided.status).toBe('approved');
    const after = (decided.candidate as ExtractionCandidate).fields;
    expect(after.some((field) => field.status === 'conflict')).toBe(false);
    expect(after.filter((field) => conflicts.some((item) => fieldIdentity(item) === fieldIdentity(field)))
      .every((field) => field.status === 'extracted')).toBe(true);
  }, 30000);

  it('审核通过后可发布 real，正式目录不混入 demo', async () => {
    const prisma = new FakePrisma();
    const store = new FakeObjectStore();
    attachReviewStore(prisma);
    prisma.expectedChecklists = [];
    prisma.publishedAnnouncementVersions = [];
    prisma.expectedChecklist = {
      findUnique: async ({ where }: { where: { runId: string } }) =>
        prisma.expectedChecklists.find((row) => row.runId === where.runId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'checklist-1', ...data };
        prisma.expectedChecklists.push(row);
        return row;
      },
    };
    prisma.publishedAnnouncementVersion = {
      findFirst: async () => null,
      findMany: async ({ where }: { where: { status?: { in: string[] } } }) =>
        prisma.publishedAnnouncementVersions.filter((row) =>
          where.status?.in ? where.status.in.includes(String(row.status)) : true,
        ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        prisma.publishedAnnouncementVersions.push(data);
        return data;
      },
    };

    const submitted = await serviceFor(prisma, store).submitSource(
      {
        publisher: '宁波市教育局',
        officialUrl: ningboUrl,
        regionCode: '330200',
        sourceType: 'manual_text',
        content: ningboHtml,
        mimeType: 'text/html',
        attachments: [
          {
            name: '招聘单位岗位学历专业及资格条件表.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            bytes: ningboXlsx,
          },
        ],
      },
      's5-task4',
    );
    const run = submitted.run as { id: string; snapshotId: string };
    await serviceFor(prisma, store).runExtraction(run.id);
    const candidate = prisma.extractionRuns.find((row) => row.id === run.id)!.candidate as ExtractionCandidate;
    const announcements = new AnnouncementsService(prisma as never);
    const frozen = await announcements.freezeChecklist(
      run.id,
      {
        source: 'retrospective',
        jobs: [...new Set(candidate.fields.map((field) => field.jobScope?.key).filter(Boolean))].map((key) => ({
          key: key as string,
        })),
        note: '岗位集合来自本次已解析的真实 xlsx，属回顾性核对，不是独立清点。',
      },
      { id: 'operator-1' },
    );
    expect(frozen.checklist.source).toBe('retrospective');
    expect(frozen.checklist.jobs.length).toBeGreaterThan(0);

    const warnings = ((candidate.rawJson as { warnings?: string[] }).warnings ?? []).filter((item) => /第 10 行/.test(item));
    // 官方原件核对（2026-10-27 重采、sha256 5edcbe86370a…）：Sheet2 第 10/40/51/54 行
    // 是 4 所不同学校的 4 个真实「高中语文教师」岗位，因此按岗位数与不同单位数断言，
    // 而不是假定只有一个语文岗位。
    const chineseJobs = candidate.fields.filter(
      (field) => field.field === 'position_name' && field.value.includes('语文'),
    );
    const chineseEmployers = new Set(
      chineseJobs
        .map((field) =>
          candidate.fields.find(
            (item) => item.field === 'unit_name' && item.jobScope?.key === field.jobScope?.key,
          )?.value,
        )
        .filter(Boolean),
    );
    expect({
      count: chineseJobs.length,
      distinctEmployers: chineseEmployers.size,
      warnings,
    }).toEqual({ count: 4, distinctEmployers: 4, warnings: [] });
    const subjectFields = candidate.fields.filter((field) => field.field === 'subject');
    const publishableJobs = [...new Set(
      subjectFields
        .filter((field) => field.value.includes('语文') && field.jobScope?.key)
        .map((field) => field.jobScope!.key),
    )];
    expect(publishableJobs.length).toBeGreaterThan(0);
    const reviewedFields = candidate.fields.flatMap((field: CandidateField) => {
      if (field.jobScope?.key && !publishableJobs.includes(field.jobScope.key)) return [];
      return [{
        ...field,
        status: field.status === 'conflict' ? 'extracted' as const : field.status,
        decision: {
          action: 'adopt' as const,
          reason: '按当前候选原值确认',
          operatorId: 'reviewer-1',
          decidedAt: '2026-10-26T10:30:00.000Z',
        },
      }];
    });
    const reviewed = await announcements.submitReview(
      {
        runId: run.id,
        action: 'approve_with_edit',
        reason: '只放行已确认语文岗位，并补录正式发布必需证据',
        editedFields: [
          ...reviewedFields,
          ...['announcement_title', 'region', 'registration_time'].map((name) => ({
            field: name,
            value: name === 'region'
              ? '浙江省宁波市'
              : name === 'registration_time'
                ? '自公告发布之日至2026年7月16日'
                : '宁波市教育局直属学校公开招聘事业编制教师公告',
            status: 'extracted' as const,
            scope: 'announcement' as const,
            anchor: {
              field: name,
              locator: {
                kind: 'excerpt' as const,
                excerpt: name === 'registration_time'
                  ? '官方正文：网上报名时间：自公告发布之日至2026年7月16日'
                  : '官方正文或岗位表已人工核对',
              },
            },
            decision: {
              action: 'edit' as const,
              reason: '正式发布必需字段由审核员按官方原文补录，不从 URL 猜测',
              operatorId: 'reviewer-1',
              decidedAt: '2026-10-26T10:30:00.000Z',
            },
          })),
          ...publishableJobs.flatMap((jobKey) => {
            // 官方岗位表未设编号列：以官方附件工作表行号作为可核对标识（不虚构编号），
            // 并按审核规则把未载明的用工性质标记为「未说明」，不猜测编制类型。
            const row = /row:(\d+)/.exec(jobKey)?.[1] ?? '未知行';
            const jobUnit = candidate.fields.find(
              (f) => f.field === 'unit_name' && f.jobScope?.key === jobKey,
            )?.value ?? '';
            const jobPosition = candidate.fields.find(
              (f) => f.field === 'position_name' && f.jobScope?.key === jobKey,
            )?.value ?? '';
            const perJob = [
              {
                field: 'job_code',
                value: `附件1-Sheet2-第${row}行`,
                status: 'extracted' as const,
                scope: 'job' as const,
                jobScope: { key: jobKey },
                anchor: {
                  field: 'job_code',
                  locator: {
                    kind: 'excerpt' as const,
                    excerpt: `官方岗位表未设编号列，以官方附件工作表行号作为可核对标识：${jobUnit}·${jobPosition}（Sheet2 第 ${row} 行）`,
                  },
                },
                decision: {
                  action: 'edit' as const,
                  reason: '岗位编号由审核员以官方附件行号补录，不虚构编号',
                  operatorId: 'reviewer-1',
                  decidedAt: '2026-10-26T10:30:00.000Z',
                },
              },
              {
                field: 'employment_nature',
                value: '未说明（岗位表未载明）',
                status: 'extracted' as const,
                scope: 'job' as const,
                jobScope: { key: jobKey },
                anchor: {
                  field: 'employment_nature',
                  locator: {
                    kind: 'excerpt' as const,
                    excerpt: '官方岗位表未载明编制/用工性质，审核标记为未说明',
                  },
                },
                decision: {
                  action: 'edit' as const,
                  reason: '官方未载明用工性质，按审核规则标记未说明，不猜测编制类型',
                  operatorId: 'reviewer-1',
                  decidedAt: '2026-10-26T10:30:00.000Z',
                },
              },
              {
                field: 'age',
                value: '有相应教师资格证书，年龄符合公告条件',
                status: 'extracted' as const,
                scope: 'job' as const,
                jobScope: { key: jobKey },
                anchor: {
                  field: 'age',
                  locator: {
                    kind: 'excerpt' as const,
                    excerpt: '岗位表其他资格条件列含年龄条件',
                  },
                },
                decision: {
                  action: 'edit' as const,
                  reason: '年龄条件由审核员按岗位表原文补录',
                  operatorId: 'reviewer-1',
                  decidedAt: '2026-10-26T10:30:00.000Z',
                },
              },
            ];
            return perJob;
          }),
        ],
        fieldDecisions: candidate.fields.map((field: CandidateField) => ({
          identity: fieldIdentity(field),
          field: field.field,
          action: 'adopt' as const,
          reason: '按当前候选原值确认',
        })),
      },
      { id: 'reviewer-1', name: '审核员' },
    );
    expect(reviewed.status).toBe('approved');

    const published = await announcements.publish(run.id, 'real');
    expect(published.payload.dataset).toBe('real');
    expect(published.payload.announcement.officialUrl).toBe(ningboUrl);
    expect(published.payload.announcement.reviewedBy).toBe('reviewer-1');
    expect(published.payload.version.units.length).toBeGreaterThan(0);
    expect(prisma.extractionRuns.find((row) => row.id === run.id)!.status).toBe('published');

    prisma.publishedAnnouncementVersions.push({
      id: 'demo-version',
      announcementId: 'demo-announcement',
      status: 'published',
      versionNumber: 1,
      payload: { dataset: 'demo', announcement: { officialUrl: 'https://example.gov.cn/demo' } },
      publishedAt: new Date(),
    });
    const catalog = await new PublishedCatalogRepository(prisma as never).listPublished(new Date());
    expect(catalog.map((item) => item.officialUrl)).toEqual([ningboUrl]);
    expect(catalog.some((item) => /example\.gov\.cn/.test(item.officialUrl))).toBe(false);
  }, 30000);
});
