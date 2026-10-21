/**
 * M1：ManualExtractionService 集成测试。
 *
 * 验证后台手动提交/提取真实复用新多岗位抽取链路（正文 + 附件材料包），
 * 而非旧 parser.ts。覆盖 M1 验收：
 * - M1-01：正文 + 两行语文岗位表附件 → 两个不同 job scope，值与定位正确；
 * - M1-02：附件不可读/不支持 → 部分完成 + 明确未处理文件与原因；
 * - M1-03：同快照同版本重复触发 → 幂等，不新增重复岗位、不覆盖人工决定；
 * - M1-04：刷新读取 run 与文件对应一致（rawJson.files 关联 document/snapshot id）。
 *
 * 全部离线：FakePrisma / FakeObjectStore / 真实 DocumentParserService（无网络）。
 */
import { describe, expect, it } from 'vitest';
import { FakeObjectStore, FakePrisma } from '../sourcing/testing/crawl-testing.js';
import { DocumentParserService } from '../document-processing/document-parser.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import { readParseLimits } from '../document-processing/parse-guard.js';
import { readFeatureFlags } from '../document-processing/feature-flags.js';
import { buildXlsxFixture } from '../document-processing/testing/fixture-builders.js';
import { ManualExtractionService } from './manual-extraction.service.js';

const BODY_HTML = `<!doctype html><html><head><title>杭州市教育局2026年教师公开招聘公告</title></head>
<body>
<p>报名时间：2026年10月1日至2026年10月7日。</p>
<p>笔试时间：2026年12月13日。</p>
<p>本次招聘均纳入事业编制，招聘50名教师。</p>
<p>学历要求：本科及以上，须具有教师资格证，年龄35周岁及以下。</p>
</body></html>`;

function makeService() {
  const prisma = new FakePrisma();
  const store = new FakeObjectStore();
  const parseStore = new DocumentParseStore(prisma as never);
  const parserService = new DocumentParserService({
    limits: readParseLimits({}),
    flags: readFeatureFlags({}),
  });
  const service = new ManualExtractionService(
    prisma as never,
    parserService,
    parseStore,
    store,
  );
  return { prisma, store, service };
}

async function submitBodyWithAttachment(ctx: ReturnType<typeof makeService>, attachmentBytes: Buffer) {
  return ctx.service.submitSource(
    {
      publisher: '杭州市教育局',
      officialUrl: 'https://example.gov.cn/notice/2026-hz',
      sourceType: 'manual_text',
      content: BODY_HTML,
      mimeType: 'text/html',
      attachments: [
        { name: '岗位表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: attachmentBytes },
      ],
    },
    'admin-1',
  );
}

describe('ManualExtractionService.submitSource + runExtraction', () => {
  it('M1-01：正文 + 两行岗位表附件 → 两个不同 job scope，值与定位正确', async () => {
    const ctx = makeService();
    const { run } = (await submitBodyWithAttachment(ctx, buildXlsxFixture())) as {
      run: { id: string; snapshotId: string; parserVersion: string };
    };

    const outcome = await ctx.service.runExtraction(run.id);

    expect(outcome.status).toBe('pending_review');
    expect(outcome.parserVersion).toBe('rule-field-extractor@2.0.0');
    const candidate = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!.candidate as {
      fields: Array<{
        field: string;
        value: string;
        scope?: string;
        jobScope?: { key: string; jobCode?: string; sheet?: string; row?: number };
        anchor?: { locator: { kind: string } };
      }>;
    };

    // 两个岗位（xlsx fixture 里 2026-HZ-01 语文 / 2026-HZ-02 数学）
    const jobFields = candidate.fields.filter((f) => f.scope === 'job');
    const jobKeys = new Set(jobFields.map((f) => f.jobScope?.key));
    expect(jobKeys.size).toBe(2);

    const majors = candidate.fields.filter((f) => f.field === 'major').map((f) => f.value).sort();
    expect(majors).toEqual(expect.arrayContaining(['汉语言文学', '数学']));

    // 岗位字段带 worksheet 证据定位（能回到附件单元格）
    const edu = candidate.fields.find((f) => f.field === 'education' && f.scope === 'job');
    expect(edu).toBeTruthy();
    expect(edu!.anchor?.locator.kind).toBe('worksheet');

    // 公告级字段（报名时间）来自正文，scope=announcement
    const reg = candidate.fields.find((f) => f.field === 'registration_time');
    expect(reg).toBeTruthy();
    expect(reg!.scope).toBe('announcement');

    // 材料包：正文 + 附件文件状态一一对应，run 与文件关联可追溯
    expect(outcome.files.length).toBe(2);
    const bodyFile = outcome.files.find((f) => f.kind === 'body');
    const attFile = outcome.files.find((f) => f.kind === 'attachment');
    expect(bodyFile?.readStatus).toBe('ok');
    expect(attFile?.readStatus).toBe('ok');
    expect(attFile?.documentId).toBeTruthy();
    expect(attFile?.snapshotId).toBeTruthy();
  });

  it('M1-02：附件不可读 → 部分完成 + 明确未处理文件与原因', async () => {
    const ctx = makeService();
    // 附件为不可读二进制（非受支持格式）
    const badAttachment = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const { run } = (await submitBodyWithAttachment(ctx, badAttachment)) as {
      run: { id: string };
    };

    const outcome = await ctx.service.runExtraction(run.id);

    // 正文可读、附件不可读 → 部分完成（仍有正文字段，不整体失败）
    expect(outcome.status).toBe('partial');
    const attFile = outcome.files.find((f) => f.kind === 'attachment');
    expect(attFile?.readStatus).toBe('unsupported');
    expect(attFile?.reason).toBeTruthy();
    // 正文字段仍在（报名时间等）
    expect(outcome.fieldCount).toBeGreaterThan(0);
  });

  it('M1-02b：无任何可读字段（正文也不可读）→ 诚实失败，不伪装成功', async () => {
    const ctx = makeService();
    const badBody = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11]);
    const { run } = (await ctx.service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://example.gov.cn/bad',
        sourceType: 'manual_text',
        content: badBody.toString('latin1'),
        mimeType: 'application/octet-stream',
      },
      'admin-1',
    )) as { run: { id: string } };

    const outcome = await ctx.service.runExtraction(run.id);

    expect(outcome.status).toBe('failed');
    expect(outcome.fieldCount).toBe(0);
    const failedRun = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!;
    expect(failedRun.status).toBe('failed');
    expect(failedRun.errorCode).toBe('NO_CANDIDATE_FIELDS');
  });

  it('M1-03：同快照同版本重复触发 → 幂等，不新增重复岗位', async () => {
    const ctx = makeService();
    const { run } = (await submitBodyWithAttachment(ctx, buildXlsxFixture())) as {
      run: { id: string };
    };
    const first = await ctx.service.runExtraction(run.id);
    const runCountAfterFirst = ctx.prisma.extractionRuns.length;

    // 重复提交同内容 → 复用快照，不新建 run
    const secondSubmit = (await submitBodyWithAttachment(ctx, buildXlsxFixture())) as {
      run: { id: string };
    };
    expect(ctx.prisma.extractionRuns.length).toBe(runCountAfterFirst); // 幂等，不新增 run
    expect(secondSubmit.run.id).toBe(run.id);

    // 同 run 再次 runExtraction：状态已是 pending_review，不能重复提取（不覆盖人工决定）
    await expect(ctx.service.runExtraction(run.id)).rejects.toThrow(/不能开始提取/);
    expect(first.status).toBe('pending_review');
  });

  it('M1-04：run 与材料包文件对应一致（rawJson.files 记录 document/snapshot id）', async () => {
    const ctx = makeService();
    const { run } = (await submitBodyWithAttachment(ctx, buildXlsxFixture())) as {
      run: { id: string };
    };
    await ctx.service.runExtraction(run.id);

    const savedRun = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!;
    const rawJson = savedRun.candidate as { rawJson: { files: Array<{ kind: string; documentId: string; snapshotId: string; name: string }> } };
    expect(rawJson.rawJson.files).toHaveLength(2);
    const att = rawJson.rawJson.files.find((f) => f.kind === 'attachment')!;
    expect(att.documentId).toBeTruthy();
    expect(att.snapshotId).toBeTruthy();
    expect(att.name).toContain('岗位表.xlsx');
  });
});
