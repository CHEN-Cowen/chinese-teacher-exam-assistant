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
import { buildXlsxFixture, buildCorrectionXlsxFixture } from '../document-processing/testing/fixture-builders.js';
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

  it('M3-遗留修复：正文不变、仅新增附件 → 材料包指纹变化 → 产生新 run', async () => {
    const ctx = makeService();

    // 第一次：仅正文（无附件）
    const first = (await ctx.service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://example.gov.cn/notice/2026-hz-onlybody',
        sourceType: 'manual_text',
        content: BODY_HTML,
        mimeType: 'text/html',
      },
      'admin-1',
    )) as { run: { id: string; materialFingerprint?: string | null } };
    await ctx.service.runExtraction(first.run.id);
    const runCountAfterFirst = ctx.prisma.extractionRuns.length;

    // 第二次：同一正文 + 新增附件（正文 contentHash 不变）
    const second = (await ctx.service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://example.gov.cn/notice/2026-hz-onlybody',
        sourceType: 'manual_text',
        content: BODY_HTML,
        mimeType: 'text/html',
        attachments: [
          { name: '岗位表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: buildXlsxFixture() },
        ],
      },
      'admin-1',
    )) as { run: { id: string; materialFingerprint?: string | null } };

    // 关键断言：材料包变了，必须产生新 run，而不是命中旧幂等键
    expect(ctx.prisma.extractionRuns.length).toBe(runCountAfterFirst + 1);
    expect(second.run.id).not.toBe(first.run.id);

    // 新 run 带材料包指纹，旧 run（仅正文）无指纹
    expect(second.run.materialFingerprint).toBeTruthy();
    expect(first.run.materialFingerprint ?? null).toBeNull();

    // 新 run 能正常提取，且包含附件产出的岗位字段
    const outcome = await ctx.service.runExtraction(second.run.id);
    expect(outcome.status).toBe('pending_review');
    const saved = ctx.prisma.extractionRuns.find((r) => r.id === second.run.id)!;
    const fields = (saved.candidate as { fields: Array<{ scope?: string }> }).fields;
    expect(fields.some((f) => f.scope === 'job')).toBe(true);

    // 第三次：完全相同（正文 + 同一附件）再次提交 → 幂等，复用第二次的 run
    const third = (await ctx.service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://example.gov.cn/notice/2026-hz-onlybody',
        sourceType: 'manual_text',
        content: BODY_HTML,
        mimeType: 'text/html',
        attachments: [
          { name: '岗位表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: buildXlsxFixture() },
        ],
      },
      'admin-1',
    )) as { run: { id: string } };
    expect(ctx.prisma.extractionRuns.length).toBe(runCountAfterFirst + 1);
    expect(third.run.id).toBe(second.run.id);
  });
});

// ==================== M3：跨文件归属与冲突复核（真实链路） ====================
// 真实 xlsx（岗位表 2 人）+ 真实 xlsx（更正表 3 人，同岗位代码）经正式
// 提取/复核服务产生冲突——不是手工构造的 conflict 对象。

describe('M3：正文 + 岗位表附件 + 更正表附件 → 跨文件冲突复核', () => {
  async function submitBodyWithTwoAttachments(
    ctx: ReturnType<typeof makeService>,
    att1: Buffer,
    att2: Buffer,
  ) {
    return ctx.service.submitSource(
      {
        publisher: '杭州市教育局',
        officialUrl: 'https://example.gov.cn/notice/2026-hz-m3',
        sourceType: 'manual_text',
        content: BODY_HTML,
        mimeType: 'text/html',
        attachments: [
          { name: '岗位表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: att1 },
          { name: '更正表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: att2 },
        ],
      },
      'admin-1',
    );
  }

  it('M3-01（真实链路）：同岗位岗位表 2 人、更正表 3 人 → conflict 两值两证据', async () => {
    const ctx = makeService();
    const { run } = (await submitBodyWithTwoAttachments(
      ctx,
      buildXlsxFixture(),
      buildCorrectionXlsxFixture(),
    )) as { run: { id: string } };

    const outcome = await ctx.service.runExtraction(run.id);
    expect(outcome.status).toBe('pending_review');

    const candidate = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!.candidate as {
      fields: Array<{
        field: string;
        value: string;
        status?: string;
        scope?: string;
        jobScope?: { key: string; jobCode?: string };
        alternatives?: Array<{ value: string; ruleVersion?: string; sourceFile?: string }>;
        anchors?: Array<{ locator: { kind: string; fileId?: string } }>;
      }>;
      rawJson: {
        files: Array<{ name: string; kind: string }>;
        reconciliation: {
          conflicts: Array<{
            identity: string;
            field: string;
            values: Array<{ value: string; sourceFile: string }>;
            suspectedCorrection: boolean;
          }>;
          merged: Array<{ identity: string; evidenceCount: number }>;
          unattributed: Array<{ field: string }>;
        };
      };
    };

    // 三个材料文件都参与复核
    expect(candidate.rawJson.files).toHaveLength(3);
    expect(candidate.rawJson.reconciliation).toBeTruthy();

    // 岗位 2026-HZ-01 的 headcount：岗位表 2 vs 更正表 3 → conflict
    const headcount = candidate.fields.find(
      (f) =>
        f.field === 'headcount' &&
        f.jobScope?.key === 'job:2026-HZ-01',
    )!;
    expect(headcount).toBeTruthy();
    expect(headcount.status).toBe('conflict');
    // 两值（2 与 3）+ 两证据（各自 worksheet 来源 + 提取版本）
    expect(headcount.alternatives!.map((a) => a.value).sort()).toEqual(['2', '3']);
    for (const alt of headcount.alternatives!) {
      expect(alt.ruleVersion).toBeTruthy();
      expect(alt.sourceFile).toBeTruthy();
    }
    // anchors 保留全部来源锚点
    expect(headcount.anchors!.length).toBeGreaterThanOrEqual(2);

    // 复核报告登记冲突（来源含岗位表与更正表）
    const conflict = candidate.rawJson.reconciliation.conflicts.find(
      (c) => c.field === 'headcount',
    )!;
    expect(conflict).toBeTruthy();
    expect(conflict.values.map((v) => v.value).sort()).toEqual(['2', '3']);
    expect(conflict.values.some((v) => v.sourceFile.includes('更正表'))).toBe(true);

    // 岗位 2026-HZ-02（只在岗位表）不受影响，仍 extracted
    const job02Headcount = candidate.fields.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:2026-HZ-02',
    )!;
    expect(job02Headcount.status).toBe('extracted');
    expect(job02Headcount.value).toBe('1');
  });

  it('M3-03（真实链路）：正文总人数与岗位人数并存，互不覆盖', async () => {
    const ctx = makeService();
    // BODY_HTML 正文含「招聘50名教师」→ M3 修复后公告级 headcount 不再被
    // 表格抢占丢弃；与岗位级 headcount（scope 不同）并存。
    const { run } = (await submitBodyWithTwoAttachments(
      ctx,
      buildXlsxFixture(),
      buildCorrectionXlsxFixture(),
    )) as { run: { id: string } };

    await ctx.service.runExtraction(run.id);
    const candidate = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!.candidate as {
      fields: Array<{ field: string; value: string; status?: string; scope?: string; jobScope?: { key: string } }>;
    };

    // 公告级 headcount=50（来自正文），不被岗位表抢占丢弃
    const annHeadcount = candidate.fields.find(
      (f) => f.field === 'headcount' && (f.scope ?? 'announcement') === 'announcement',
    );
    expect(annHeadcount).toBeTruthy();
    expect(annHeadcount!.value).toBe('50');
    expect(annHeadcount!.status).toBe('extracted');

    // 岗位级 headcount 各自保留（01 冲突 2/3、02 为 1），总数不塞入任何岗位
    const jobCounts = candidate.fields.filter(
      (f) => f.field === 'headcount' && f.scope === 'job',
    );
    const job01Values = jobCounts
      .filter((f) => f.jobScope?.key === 'job:2026-HZ-01')
      .flatMap((f) => (f.status === 'conflict' ? f.alternatives?.map((a) => a.value) ?? [] : [f.value]));
    expect(job01Values.sort((a, b) => a.localeCompare(b))).toEqual(['2', '3']);
    expect(
      jobCounts.some((f) => f.value === '50'),
    ).toBe(false);
  });

  it('M3-04（真实链路）：同岗位同值多来源合并保留双证据', async () => {
    const ctx = makeService();
    // 两个附件给出完全相同的岗位表（同内容 → 内容哈希相同 → 复用同一快照，
    // 不会产生两个来源）。改用「岗位表 + 同岗位代码的另一表」验证同值合并：
    // 更正表与岗位表的 2026-HZ-02 行不存在（更正表只有 01），
    // 因此这里用岗位表两次但内容不同来验证 01 行的 education 同值合并——
    // 构造：岗位表（本科及以上）+ 更正表（本科及以上 同值，headcount 不同）。
    const { run } = (await submitBodyWithTwoAttachments(
      ctx,
      buildXlsxFixture(),
      buildCorrectionXlsxFixture(),
    )) as { run: { id: string } };

    await ctx.service.runExtraction(run.id);
    const candidate = ctx.prisma.extractionRuns.find((r) => r.id === run.id)!.candidate as {
      fields: Array<{
        field: string;
        value: string;
        status?: string;
        jobScope?: { key: string };
        anchors?: Array<{ locator: { fileId?: string } }>;
      }>;
      rawJson: { reconciliation: { merged: Array<{ identity: string; field: string; evidenceCount: number }> } };
    };

    // 岗位 2026-HZ-01 的 education：两个来源（岗位表/更正表）同值「本科及以上」
    // → 合并为一条候选，anchors 保留双证据
    const educations = candidate.fields.filter(
      (f) => f.field === 'education' && f.jobScope?.key === 'job:2026-HZ-01',
    );
    expect(educations).toHaveLength(1);
    expect(educations[0]!.status).toBe('extracted');
    expect(educations[0]!.value).toBe('本科及以上');
    expect(educations[0]!.anchors!.length).toBeGreaterThanOrEqual(2);

    // 复核报告登记合并（证据数 ≥ 2）
    const merged = candidate.rawJson.reconciliation.merged.find(
      (m) => m.field === 'education' && m.identity.includes('job:2026-HZ-01'),
    );
    expect(merged).toBeTruthy();
    expect(merged!.evidenceCount).toBeGreaterThanOrEqual(2);
  });
});
