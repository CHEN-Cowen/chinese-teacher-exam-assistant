/**
 * M3：跨文件归属与冲突复核——纯函数测试。
 *
 * 覆盖提示词测试矩阵 M3-01 ~ M3-09 的可纯函数验证部分；
 * 真实解析链路（xlsx → 提取 → 复核产生冲突）在 manual-extraction.service.spec.ts。
 */
import { describe, expect, it } from 'vitest';
import { reconcileFields, type ReconcileSource } from './field-reconciler.js';
import { assertPublishable } from './quality-gates.js';
import { applyFieldDecisions, fieldIdentity, type CandidateField } from './domain.js';
import { buildExportRows, computeExportMetrics } from './export.js';

// ==================== 夹具 ====================

function jobField(
  field: string,
  value: string,
  jobKey: string,
  extra: Partial<CandidateField> = {},
): CandidateField {
  return {
    field,
    value,
    status: 'extracted',
    scope: 'job',
    jobScope: { key: jobKey, jobCode: jobKey.replace('job:', '') },
    ruleVersion: 'rule-field-extractor@2.0.0',
    origin: 'rule',
    anchor: {
      field,
      locator: {
        kind: 'worksheet',
        fileId: 'snap-att',
        fileName: '岗位表.xlsx',
        sheet: '岗位表',
        cell: 'E2',
      },
      excerpt: value,
    },
    ...extra,
  };
}

function annField(
  field: string,
  value: string,
  extra: Partial<CandidateField> = {},
): CandidateField {
  return {
    field,
    value,
    status: 'extracted',
    scope: 'announcement',
    ruleVersion: 'rule-field-extractor@2.0.0',
    origin: 'rule',
    anchor: {
      field,
      locator: { kind: 'excerpt', excerpt: `${field}：${value}` },
    },
    ...extra,
  };
}

/** 构造来源（默认正文 + 附件两个来源） */
function source(
  kind: 'body' | 'attachment',
  fields: CandidateField[],
  opts: { name?: string; snapshotId?: string; relationType?: string | null } = {},
): ReconcileSource {
  const name = opts.name ?? (kind === 'body' ? '公告正文' : '附件');
  return {
    file: {
      documentId: `doc-${name}`,
      snapshotId: opts.snapshotId ?? `snap-${name}`,
      name,
      kind,
      relationType: opts.relationType ?? null,
    },
    fields,
  };
}

// ==================== M3-01：同岗位不同值 → conflict ====================

describe('M3-01 同岗位正文 2 人、附件 3 人 → conflict，两值两证据，未裁决不发布', () => {
  it('两来源同岗位 headcount 不同值 → conflict + alternatives 两值两证据', () => {
    const body = source('body', [jobField('headcount', '2', 'job:3301A01', {
      anchor: {
        field: 'headcount',
        locator: { kind: 'excerpt', excerpt: '正文：岗位3301A01招聘2人' },
      },
    })]);
    const att = source('attachment', [jobField('headcount', '3', 'job:3301A01', {
      anchor: {
        field: 'headcount',
        locator: {
          kind: 'worksheet',
          fileId: 'snap-att',
          fileName: '更正表.xlsx',
          sheet: '岗位表',
          cell: 'E2',
        },
        excerpt: '3',
      },
    })]);

    const { fields, report } = reconcileFields([body, att]);

    const headcount = fields.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:3301A01',
    )!;
    expect(headcount.status).toBe('conflict');
    // 两值两证据
    expect(headcount.alternatives).toHaveLength(2);
    expect(headcount.alternatives!.map((a) => a.value).sort()).toEqual(['2', '3']);
    for (const alt of headcount.alternatives!) {
      expect(alt.source).toBeTruthy();
      expect(alt.ruleVersion).toBeTruthy();
    }
    // 报告登记冲突
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.identity).toContain('job:3301A01:headcount');

    // 未裁决不发布（conflict 是发布门禁）
    expect(() =>
      assertPublishable({ fields, parserVersion: 'rule-field-extractor@2.0.0' }),
    ).toThrow();
  });
});

// ==================== M3-02：不同岗位不误报冲突 ====================

describe('M3-02 岗位 A 2 人、岗位 B 3 人 → 独立岗位，不误报冲突', () => {
  it('不同 jobKey 的同名字段不合并、不判冲突', () => {
    const body = source('body', [
      jobField('headcount', '2', 'job:3301A01'),
    ]);
    const att = source('attachment', [
      jobField('headcount', '3', 'job:3301A02'),
    ]);

    const { fields, report } = reconcileFields([body, att]);

    const counts = fields.filter((f) => f.field === 'headcount');
    expect(counts).toHaveLength(2);
    for (const c of counts) expect(c.status).toBe('extracted');
    expect(report.conflicts).toHaveLength(0);
  });
});

// ==================== M3-03：公告总数不塞入岗位 ====================

describe('M3-03 公告总人数 5、岗位 A 2 / B 3 → 不把总数塞入任一岗位', () => {
  it('公告级 headcount 与岗位级 headcount 分属不同 scope，各自保留', () => {
    const body = source('body', [
      annField('headcount', '5'), // 公告总人数
      annField('employment_nature', '事业编制'),
    ]);
    const att = source('attachment', [
      jobField('headcount', '2', 'job:3301A01'),
      jobField('headcount', '3', 'job:3301A02'),
    ]);

    const { fields, report } = reconcileFields([body, att]);

    // 公告级 headcount 保留为 announcement 候选，不进任何岗位
    const annCount = fields.find(
      (f) => f.field === 'headcount' && (f.scope ?? 'announcement') === 'announcement',
    );
    expect(annCount).toBeTruthy();
    expect(annCount!.value).toBe('5');

    // 岗位级各自保留原值，未被总数覆盖
    const jobCounts = fields.filter(
      (f) => f.field === 'headcount' && f.scope === 'job',
    );
    expect(jobCounts.map((f) => f.value).sort()).toEqual(['2', '3']);

    // 无冲突（scope 不同是不同槽位）
    expect(report.conflicts).toHaveLength(0);

    // 适用关系对照列出「公告总数 vs 岗位各自人数」
    const relation = report.applicabilityRelations.find((r) => r.field === 'headcount');
    expect(relation).toBeTruthy();
    expect(relation!.announcementValue).toBe('5');
    expect(relation!.jobValues).toHaveLength(2);
  });
});

// ==================== M3-04：同值合并保留双证据 ====================

describe('M3-04 同岗位同值两来源 → 不重复计数，保留双证据', () => {
  it('同值合并为一条候选，anchors 保留两个来源的证据', () => {
    const body = source('body', [
      jobField('major', '汉语言文学（师范）', 'job:3301A01', {
        anchor: {
          field: 'major',
          locator: { kind: 'excerpt', excerpt: '正文：专业为汉语言文学（师范）' },
        },
      }),
    ]);
    const att = source('attachment', [
      jobField('major', '汉语言文学（师范）', 'job:3301A01'),
    ]);

    const { fields, report } = reconcileFields([body, att]);

    const majors = fields.filter(
      (f) => f.field === 'major' && f.jobScope?.key === 'job:3301A01',
    );
    // 不重复计数：一条候选
    expect(majors).toHaveLength(1);
    expect(majors[0]!.status).toBe('extracted');
    expect(majors[0]!.value).toBe('汉语言文学（师范）');

    // 保留双证据（anchors 数组含两个来源的锚点）
    expect(majors[0]!.anchors).toHaveLength(2);
    expect(report.merged).toHaveLength(1);
    expect(report.merged[0]!.evidenceCount).toBe(2);
  });
});

// ==================== M3-05：公共条件与岗位特例分别保留 ====================

describe('M3-05 公共年龄 35、明确硕士例外 40 → 保留公共条件和例外，展示适用关系', () => {
  it('announcement age 与 job age 并存不覆盖；age_exception 独立保留；适用关系可查', () => {
    const body = source('body', [
      annField('age', '35周岁及以下'),
      annField('age_basis_date', '2026-11-05'),
      annField('age_exception', '硕士研究生及以上学历报考者，年龄放宽至40周岁及以下'),
    ]);
    const att = source('attachment', [
      jobField('age', '40周岁及以下（硕士放宽）', 'job:3301A01'),
    ]);

    const { fields, report } = reconcileFields([body, att]);

    // 公共条件保留（announcement 级）
    const annAge = fields.find(
      (f) => f.field === 'age' && (f.scope ?? 'announcement') === 'announcement',
    );
    expect(annAge!.value).toBe('35周岁及以下');
    // 岗位特例保留（job 级，不覆盖公共规则）
    const jobAge = fields.find(
      (f) => f.field === 'age' && f.scope === 'job',
    );
    expect(jobAge!.value).toContain('40周岁');
    // 例外与基准日独立保留（不并入 age 文本）
    expect(
      fields.find((f) => f.field === 'age_exception')!.value,
    ).toContain('40周岁');
    expect(fields.find((f) => f.field === 'age_basis_date')!.value).toBe('2026-11-05');

    // 无冲突；适用关系对照展示
    expect(report.conflicts).toHaveLength(0);
    const relation = report.applicabilityRelations.find((r) => r.field === 'age');
    expect(relation).toBeTruthy();
    expect(relation!.announcementValue).toBe('35周岁及以下');
    expect(relation!.jobValues).toHaveLength(1);
  });
});

// ==================== M3-06：批次维度不串批次 ====================

describe('M3-06 两批次不同报名入口/时间 → 不串批次，不自动判冲突', () => {
  it('同字段不同 batchId → 不同 identity，各自保留不判冲突', () => {
    const body = source('body', [
      annField('official_entry', 'https://example.gov.cn/apply-batch1', { batchId: 'batch-2026-01' }),
      annField('registration_time', '2026年10月20日至2026年11月5日', { batchId: 'batch-2026-01' }),
    ]);
    const att = source('attachment', [
      annField('official_entry', 'https://example.gov.cn/apply-batch2', { batchId: 'batch-2026-02' }),
      annField('registration_time', '2026年12月1日至2026年12月10日', { batchId: 'batch-2026-02' }),
    ]);

    const { fields, report } = reconcileFields([body, att]);

    // 两批次各自保留，不合并、不冲突
    const entries = fields.filter((f) => f.field === 'official_entry');
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.status).toBe('extracted');
    expect(report.conflicts).toHaveLength(0);

    // identity 含 batchId 维度
    expect(fieldIdentity(entries[0]!)).not.toBe(fieldIdentity(entries[1]!));
  });

  it('同批次（batchId 缺省视为同一）同字段不同值 → 保守判冲突待人工', () => {
    const body = source('body', [annField('official_entry', 'https://example.gov.cn/apply-a')]);
    const att = source('attachment', [annField('official_entry', 'https://example.gov.cn/apply-b')]);

    const { fields, report } = reconcileFields([body, att]);

    // 无批次信息且值不同 → 不能确定是否同批次，保守冲突待人工
    const entry = fields.find((f) => f.field === 'official_entry')!;
    expect(entry.status).toBe('conflict');
    expect(entry.alternatives).toHaveLength(2);
    expect(report.conflicts).toHaveLength(1);
  });
});

// ==================== M3-07：更正关系 ====================

describe('M3-07 明确更正文件将 2 改 3 → 冲突 + 更正标注；人工裁决后新值生效、旧值可查', () => {
  it('replacement 关系附件与正文不同值 → conflict + suspectedCorrection；裁决后新值 3、旧值留痕', () => {
    const body = source('body', [
      jobField('headcount', '2', 'job:3301A01', {
        anchor: {
          field: 'headcount',
          locator: { kind: 'excerpt', excerpt: '正文：岗位3301A01招聘2人' },
        },
      }),
    ]);
    const correction = source('attachment', [
      jobField('headcount', '3', 'job:3301A01'),
    ], { name: '更正表.xlsx', relationType: 'replacement' });

    const { fields, report } = reconcileFields([body, correction]);

    // 确认前旧值不失效：仍是 conflict，不自动采信更正值
    const headcount = fields.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:3301A01',
    )!;
    expect(headcount.status).toBe('conflict');
    expect(report.conflicts[0]!.suspectedCorrection).toBe(true);
    expect(report.warnings.some((w) => w.includes('疑似更正'))).toBe(true);
    // alternatives 保留旧值 2 与更正值 3（含来源文件名）
    expect(headcount.alternatives!.map((a) => a.value).sort()).toEqual(['2', '3']);
    expect(
      headcount.alternatives!.some((a) => a.sourceFile === '更正表.xlsx'),
    ).toBe(true);

    // 人工裁决（M3-09 前置）：选更正值 3 → 新有效值 3，旧值与关系可查
    const decided = applyFieldDecisions(
      fields,
      [
        {
          identity: fieldIdentity(headcount),
          field: 'headcount',
          action: 'edit',
          afterValue: '3',
          reason: '官方更正文件（replacement）确认人数为 3，采信更正值',
        },
      ],
      'reviewer-1',
      '2026-10-21T13:00:00.000Z',
    );
    const decidedField = decided.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:3301A01',
    )!;
    expect(decidedField.value).toBe('3');
    expect(decidedField.decision?.action).toBe('edit');
    // 原 alternatives 与证据保留（不抹掉历史）
    expect(decidedField.alternatives!.map((a) => a.value).sort()).toEqual(['2', '3']);
  });
});

// ==================== M3-08：身份/关系不明 → 待人工 ====================

describe('M3-08 不明来源/岗位或更正关系不明 → 待人工，不猜归属或覆盖', () => {
  it('scope=unknown 的字段 → 待归属报告，不参与合并', () => {
    const body = source('body', [
      { ...annField('headcount', '5'), scope: 'unknown' as const },
    ]);
    const att = source('attachment', [jobField('headcount', '2', 'job:3301A01')]);

    const { fields, report } = reconcileFields([body, att]);

    // scope=unknown 保留独立候选 + 待归属报告，不与岗位合并
    const unknownField = fields.find((f) => f.scope === 'unknown');
    expect(unknownField).toBeTruthy();
    expect(report.unattributed).toHaveLength(1);
    expect(report.unattributed[0]!.reason).toBe('scope_unknown');
    // 无冲突（unknown 与 job 不是同一槽位）
    expect(report.conflicts).toHaveLength(0);
  });

  it('岗位身份不明（jobKey 为空）→ 待归属，不与已知岗位合并', () => {
    const body = source('body', [
      jobField('headcount', '2', ''), // jobKey 为空
    ]);
    const att = source('attachment', [jobField('headcount', '3', 'job:3301A01')]);

    const { fields, report } = reconcileFields([body, att]);

    // 身份不明字段独立保留，不与 job:3301A01 合并、不判冲突
    expect(report.unattributed).toHaveLength(1);
    expect(report.unattributed[0]!.reason).toBe('job_identity_unknown');
    const jobCount = fields.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:3301A01',
    );
    expect(jobCount!.status).toBe('extracted');
    expect(jobCount!.value).toBe('3');
    expect(report.conflicts).toHaveLength(0);
  });

  it('更正关系不明（relationType=null）值不同 → conflict 待人工，不自动覆盖', () => {
    const body = source('body', [
      jobField('headcount', '2', 'job:3301A01'),
    ]);
    const unknownRelation = source('attachment', [
      jobField('headcount', '3', 'job:3301A01'),
    ], { name: '不明附件.xlsx', relationType: null });

    const { fields, report } = reconcileFields([body, unknownRelation]);

    const headcount = fields.find(
      (f) => f.field === 'headcount' && f.jobScope?.key === 'job:3301A01',
    )!;
    expect(headcount.status).toBe('conflict');
    expect(report.conflicts[0]!.suspectedCorrection).toBe(false);
    expect(report.conflicts[0]!.values).toHaveLength(2);
  });
});

// ==================== M3-09：裁决 → 保存 → 读取 → 导出一致 ====================

describe('M3-09 裁决 → 保存 → 重新读取 → 导出：最终值和完整审计一致', () => {
  it('裁决后的候选经导出（CSV 行 + 指标）保留最终值、人工修订与冲突历史', () => {
    // 1. 复核产生冲突（正文 2 / 更正 3）
    const body = source('body', [
      jobField('headcount', '2', 'job:3301A01', {
        anchor: {
          field: 'headcount',
          locator: { kind: 'excerpt', excerpt: '正文：岗位3301A01招聘2人' },
        },
      }),
    ]);
    const correction = source('attachment', [
      jobField('headcount', '3', 'job:3301A01'),
    ], { name: '更正表.xlsx', relationType: 'replacement' });
    const reconciled = reconcileFields([body, correction]);

    // 2. 人工裁决（模拟 submitReview 内 applyFieldDecisions）
    const decidedFields = applyFieldDecisions(
      reconciled.fields,
      [
        {
          identity: 'job:job:3301A01:headcount',
          field: 'headcount',
          action: 'edit',
          afterValue: '3',
          reason: '官方更正文件确认人数为 3',
        },
      ],
      'reviewer-1',
      '2026-10-21T13:00:00.000Z',
    );

    // 3. 重新读取（模拟从持久化恢复的候选）→ 导出
    const candidate = {
      fields: decidedFields,
      parserVersion: 'rule-field-extractor@2.0.0',
    };
    const rows = buildExportRows({ runId: 'run-m3', snapshotId: 'snap-m3', candidate });
    const metrics = computeExportMetrics({
      runId: 'run-m3',
      status: 'approved',
      parserVersion: 'rule-field-extractor@2.0.0',
      candidate,
      retryCount: 0,
    });

    // 导出：最终值 3、人工修订 edit、原因可查
    const row = rows.find(
      (r) => r.field === 'headcount' && r.job_id === 'job:3301A01',
    )!;
    expect(row.value).toBe('3');
    expect(row.human_revision).toBe('edit');
    expect(row.reason).toContain('更正');
    // 冲突历史保留：alternatives 含旧值 2 与新值 3（完整审计）
    const alternatives = JSON.parse(row.alternatives) as Array<{ value: string }>;
    expect(alternatives.map((a) => a.value).sort()).toEqual(['2', '3']);

    // 指标：extracted 计数不重复（一条 headcount）
    const jobScopeMetric = metrics.scopes.find((s) => s.key === 'job:3301A01');
    expect(jobScopeMetric).toBeTruthy();
    expect(jobScopeMetric!.extracted).toBe(1);
  });
});

// ==================== 附加：单一来源行为不变 ====================

describe('单一来源字段原样保留（不额外加工）', () => {
  it('只有一个来源时不产生合并/冲突报告', () => {
    const body = source('body', [
      annField('registration_time', '2026年10月20日至2026年11月5日'),
      jobField('major', '汉语言文学（师范）', 'job:3301A01'),
    ]);
    const { fields, report } = reconcileFields([body]);
    expect(fields).toHaveLength(2);
    expect(report.merged).toHaveLength(0);
    expect(report.conflicts).toHaveLength(0);
    expect(report.unattributed).toHaveLength(0);
  });
});
