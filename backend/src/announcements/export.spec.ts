/**
 * WB6：审核导出与实测指标（export.ts 纯函数）单元测试。
 *
 * 输入数据全部内联（隔离约束：src/ 不得 import tests/fixtures）。
 * 指标测试数据镜像 WB0 黄金样本（tests/fixtures/workbuddy/golden-sample.json）
 * 的字段构成，断言值可人工逐条复算。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  buildExportRows,
  buildJsonExport,
  CSV_COLUMNS,
  CSV_FORMULA_NOTE,
  computeExportMetrics,
  computeScopeMetrics,
  csvEscapeCell,
  sanitizeCandidateForExport,
  sanitizeFieldForExport,
} from './export.js';
import type {
  CandidateField,
  ExtractionCandidate,
} from './domain.js';

// ==================== 夹具（镜像 WB0 黄金样本） ====================

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
    ruleVersion: 'wb-golden@1.0.0',
    origin: 'rule',
    anchor: { field, locator: { kind: 'excerpt', excerpt: `${field}原文（测试）` } },
    ...extra,
  };
}

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
    scope: 'job' as const,
    jobScope: { key: jobKey, jobCode: jobKey.replace('job-', '') },
    ruleVersion: 'wb-golden@1.0.0',
    origin: 'rule',
    anchor: {
      field,
      locator: {
        kind: 'worksheet',
        fileId: 'wb-xlsx-demo',
        fileName: '岗位表（测试）.xlsx',
        sheet: '岗位表',
        cell: 'A2',
      },
    },
    ...extra,
  };
}

/** 镜像黄金样本 candidateFields 的后端候选（23 个字段，含 1 unknown + 1 conflict） */
function goldenLikeCandidate(): ExtractionCandidate {
  return {
    fields: [
      // 公告公共（8 个去重字段，全部 extracted）
      annField('announcement_title', '【测试】示例市教育局2026年直属学校教师公开招聘公告'),
      annField('region', '杭州市'),
      annField('age_basis_date', '2026-11-05'),
      annField('age_exception', '硕士研究生及以上学历报考者，年龄放宽至40周岁及以下（测试）'),
      annField('employment_nature', '事业编制'),
      annField('registration_time', '2026-10-20 至 2026-11-05 17:00'),
      annField('materials', '本人有效居民身份证；学历学位证书；教师资格证书'),
      annField('official_entry', 'https://www.example.gov.cn/test/apply'),
      // 岗位 A（7 个去重字段，headcount 冲突）
      jobField('job_code', '3301A01', 'job-A-3301A01'),
      jobField('unit_name', '示例市第一中学（测试）', 'job-A-3301A01'),
      jobField('stage', '初中', 'job-A-3301A01'),
      jobField('subject', '语文', 'job-A-3301A01'),
      jobField('headcount', '2', 'job-A-3301A01', {
        status: 'conflict',
        alternatives: [
          {
            value: '2',
            source: { kind: 'worksheet', excerpt: '岗位表：2人' } as never,
            excerpt: '岗位表 E2',
          },
          {
            value: '3',
            source: { kind: 'file', excerpt: '附件：3人' } as never,
            excerpt: '附件第1页',
          },
        ],
      }),
      jobField('major', '汉语言文学（师范）', 'job-A-3301A01'),
      jobField('education', '本科及以上', 'job-A-3301A01'),
      // 岗位 B（8 个去重字段，degree unknown）
      jobField('job_code', '3301A02', 'job-B-3301A02'),
      jobField('unit_name', '示例市第二中学（测试）', 'job-B-3301A02'),
      jobField('stage', '高中', 'job-B-3301A02'),
      jobField('subject', '数学', 'job-B-3301A02'),
      jobField('headcount', '1', 'job-B-3301A02'),
      jobField('major', '数学与应用数学', 'job-B-3301A02'),
      jobField('education', '硕士研究生及以上', 'job-B-3301A02'),
      jobField('degree', '', 'job-B-3301A02', { status: 'unknown', value: '' }),
    ],
    parserVersion: 'wb-golden@1.0.0',
    rawJson: { internal: '不应导出的原始内容' },
  };
}

// ==================== CSV 转义与公式注入防护 ====================

describe('csvEscapeCell', () => {
  it('普通文本与中文原样输出', () => {
    expect(csvEscapeCell('汉语言文学（师范）')).toBe('汉语言文学（师范）');
    expect(csvEscapeCell('3301A01')).toBe('3301A01');
  });

  it('含逗号、双引号、换行的单元格正确转义（RFC 4180）', () => {
    expect(csvEscapeCell('a,b')).toBe('"a,b"');
    expect(csvEscapeCell('含"引号"的值')).toBe('"含""引号""的值"');
    expect(csvEscapeCell('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(csvEscapeCell('中文，逗号\n换行"引号"')).toBe(
      '"中文，逗号\n换行""引号"""',
    );
  });

  it('以 = + - @ 开头的单元格加单引号前缀防公式注入（原值紧随其后可追溯）', () => {
    expect(csvEscapeCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvEscapeCell('+cmd|/c calc')).toBe("'+cmd|/c calc");
    expect(csvEscapeCell('-1+1')).toBe("'-1+1");
    expect(csvEscapeCell('@IMPORT(X)')).toBe("'@IMPORT(X)");
  });

  it('公式前缀与引号转义叠加：含逗号的公式单元格先加前缀再整体包裹', () => {
    expect(csvEscapeCell('=1,2')).toBe('"\'=1,2"');
  });
});

describe('buildCsv', () => {
  it('表头列固定有序且带 UTF-8 BOM，换行为 CRLF', () => {
    const csv = buildCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const header = csv.replace('\uFEFF', '').split('\r\n')[0]!;
    expect(header).toBe(CSV_COLUMNS.join(','));
    expect(csv).toContain('\r\n');
  });

  it('每行按固定列顺序输出单元格（含转义值）', () => {
    const csv = buildCsv([
      { sample_id: 'snap-1', job_id: 'job-A', field: 'major', value: '语文,师范' },
    ]);
    const line = csv.split('\r\n')[1]!;
    // 前四列按固定顺序：sample_id,job_id,field,value；含半角逗号的值被引号包裹
    expect(line.startsWith('snap-1,job-A,major,"语文,师范"')).toBe(true);
  });
});

// ==================== CSV 行构造（岗位 × 字段） ====================

describe('buildExportRows', () => {
  const rows = buildExportRows({
    runId: 'run-1',
    snapshotId: 'snap-1',
    candidate: goldenLikeCandidate(),
  });

  it('两岗位同名字段（major/job_code）导出为不同行且 job_id 正确', () => {
    const majors = rows.filter((r) => r.field === 'major');
    expect(majors).toHaveLength(2);
    expect(majors.map((r) => r.job_id)).toEqual(['job-A-3301A01', 'job-B-3301A02']);
    expect(majors[0]!.value).toBe('汉语言文学（师范）');
    expect(majors[1]!.value).toBe('数学与应用数学');
  });

  it('公共字段 scope 正确：job_id 为空、scope=announcement', () => {
    const region = rows.find((r) => r.field === 'region');
    expect(region).toBeDefined();
    expect(region!.job_id).toBe('');
    expect(region!.scope).toBe('announcement');
    expect(region!.value).toBe('杭州市');
  });

  it('conflict 字段保留 alternatives（JSON 数组），status=conflict', () => {
    const headcount = rows.find(
      (r) => r.field === 'headcount' && r.job_id === 'job-A-3301A01',
    );
    expect(headcount!.status).toBe('conflict');
    const alts = JSON.parse(headcount!.alternatives) as Array<{ value: string }>;
    expect(alts).toHaveLength(2);
    expect(alts.map((a) => a.value)).toEqual(['2', '3']);
  });

  it('unknown 字段 value 为空、status=unknown', () => {
    const degree = rows.find(
      (r) => r.field === 'degree' && r.job_id === 'job-B-3301A02',
    );
    expect(degree!.status).toBe('unknown');
    expect(degree!.value).toBe('');
  });

  it('human_revision 与 reason 来自真实审核记录（字段 decision）', () => {
    const candidate = goldenLikeCandidate();
    candidate.fields = candidate.fields.map((f) => {
      if (f.field === 'major' && f.scope === 'job') {
        return {
          ...f,
          decision: {
            action: 'adopt' as const,
            beforeValue: f.value,
            afterValue: f.value,
            reason: '与岗位表原文一致',
            operatorId: 'reviewer-1',
            decidedAt: '2026-10-20T00:00:00.000Z',
          },
        };
      }
      if (f.field === 'education' && f.scope === 'job') {
        return {
          ...f,
          decision: {
            action: 'edit' as const,
            beforeValue: '本科',
            afterValue: f.value,
            reason: '附件为最新口径',
            operatorId: 'reviewer-1',
            decidedAt: '2026-10-20T00:00:00.000Z',
          },
        };
      }
      return f;
    });
    const decided = buildExportRows({
      runId: 'run-1',
      snapshotId: 'snap-1',
      candidate,
    });
    const majorA = decided.find(
      (r) => r.field === 'major' && r.job_id === 'job-A-3301A01',
    );
    expect(majorA!.human_revision).toBe('adopt');
    expect(majorA!.reason).toBe('与岗位表原文一致');
    const eduB = decided.find(
      (r) => r.field === 'education' && r.job_id === 'job-B-3301A02',
    );
    expect(eduB!.human_revision).toBe('edit');
    expect(eduB!.reason).toBe('附件为最新口径');
  });

  it('URL/query 脱敏：locator 只保留协议+host+path，query 中的签名/令牌被丢弃', () => {
    const candidate: ExtractionCandidate = {
      fields: [
        annField('official_entry', 'https://www.example.gov.cn/test/apply', {
          anchor: {
            field: 'official_entry',
            locator: {
              kind: 'url',
              url: 'https://www.example.gov.cn/test/apply?token=SECRET&X-Signature=abc',
            },
          },
        }),
      ],
      parserVersion: 'v1',
    };
    const row = buildExportRows({ runId: 'r', snapshotId: 's', candidate })[0]!;
    expect(row.locator).toBe('url:https://www.example.gov.cn/test/apply');
    expect(row.source_file).toBe('https://www.example.gov.cn/test/apply');
    expect(row.locator).not.toContain('token');
    expect(row.locator).not.toContain('X-Signature');
  });
});

// ==================== JSON 导出脱敏 ====================

describe('sanitizeCandidateForExport / sanitizeFieldForExport', () => {
  it('URL locator 去 query，其余结构原样保留', () => {
    const field = annField('official_entry', 'https://x.gov.cn/a', {
      anchor: {
        field: 'official_entry',
        locator: {
          kind: 'url',
          url: 'https://x.gov.cn/a?AccessKeyId=AK&token=TOKEN',
        } as never,
      },
    });
    const out = sanitizeFieldForExport(field);
    const locator = out.anchor!.locator as unknown as { url: string };
    expect(locator.url).toBe('https://x.gov.cn/a');
    expect(locator.url).not.toContain('AccessKeyId');
    expect(locator.url).not.toContain('TOKEN');
  });

  it('alternatives 中的 URL 同样脱敏', () => {
    const field = jobField('headcount', '2', 'job-A', {
      status: 'conflict',
      alternatives: [
        {
          value: '3',
          source: {
            kind: 'url',
            url: 'https://x.gov.cn/attach?sig=SIGNATURE',
          } as never,
        },
      ],
    });
    const out = sanitizeFieldForExport(field);
    const source = out.alternatives![0]!.source as unknown as { url: string };
    expect(source.url).toBe('https://x.gov.cn/attach');
    expect(source.url).not.toContain('sig');
  });

  it('rawJson 不进入导出候选', () => {
    const candidate = goldenLikeCandidate();
    const out = sanitizeCandidateForExport(candidate);
    expect(out.rawJson).toBeUndefined();
    expect(out.fields).toHaveLength(candidate.fields.length);
  });
});

describe('buildJsonExport', () => {
  it('包含 schema 版本、脱敏来源、审核记录、公式注入防护说明与列顺序', () => {
    const metrics = computeExportMetrics({
      runId: 'run-1',
      status: 'approved',
      parserVersion: 'wb-golden@1.0.0',
      candidate: goldenLikeCandidate(),
      createdAt: new Date('2026-10-20T01:00:00.000Z'),
      finishedAt: new Date('2026-10-20T02:00:00.000Z'),
      reviewTimes: [
        new Date('2026-10-20T01:30:00.000Z'),
        new Date('2026-10-20T01:50:00.000Z'),
      ],
      retryCount: 0,
      sourceOfficialUrl: 'https://www.example.gov.cn/test/wb-notice?token=SECRET',
    });

    const json = buildJsonExport({
      exportedAt: new Date('2026-10-21T00:00:00.000Z'),
      datasetMark: metrics.datasetMark,
      source: {
        publisher: '示例市教育局（测试）',
        officialUrl: 'https://www.example.gov.cn/test/wb-notice?token=SECRET',
      },
      run: {
        id: 'run-1',
        snapshotId: 'snap-1',
        announcementId: 'wb-ann-demo',
        status: 'approved',
        parserVersion: 'wb-golden@1.0.0',
        retryCount: 0,
        createdAt: new Date('2026-10-20T01:00:00.000Z'),
        updatedAt: new Date('2026-10-20T02:00:00.000Z'),
        finishedAt: new Date('2026-10-20T02:00:00.000Z'),
      },
      candidate: goldenLikeCandidate(),
      reviewRecords: [
        {
          action: 'approve_with_edit',
          reason: '已逐字段核对',
          reviewerId: 'reviewer-1',
          reviewerName: '测试审核员',
          reviewedAt: '2026-10-20T01:50:00.000Z',
        },
      ],
      metrics,
    });

    expect(json.schemaVersion).toBe('wb-export@1.0.0');
    expect(json.source.officialUrl).toBe('https://www.example.gov.cn/test/wb-notice');
    expect(json.reviewRecords).toHaveLength(1);
    expect(json.reviewRecords[0]!.reason).toBe('已逐字段核对');
    expect(json.csvColumnOrder).toEqual(CSV_COLUMNS);
    expect(json.notes.join('\n')).toContain(CSV_FORMULA_NOTE);
    expect(JSON.stringify(json)).not.toContain('token=SECRET');
    expect(JSON.stringify(json)).not.toContain('internal');
  });
});

// ==================== 实测指标（黄金样本人工复算） ====================

describe('computeExportMetrics：黄金样本人工复算', () => {
  // 人工复算（对照 golden-sample.json expectedReview）：
  // - 公告公共 8 个去重字段，全部 extracted → expected=8, extracted=8, unknown=0, conflict=0
  // - 岗位 A 7 个去重字段（headcount 冲突）→ expected=7, extracted=6, conflict=1
  // - 岗位 B 8 个去重字段（degree unknown）→ expected=8, extracted=7, unknown=1
  // - 合计 expected=23, extracted=21, unknown=1, conflict=1
  // - 高影响（有证据/应有）：公告 7/7（announcement_title 非注册高影响字段），
  //   岗位 A 7/7，岗位 B 8/8（degree 是注册高影响字段且带证据）→ 合计 22/22

  const metrics = computeExportMetrics({
    runId: 'run-1',
    status: 'approved',
    parserVersion: 'wb-golden@1.0.0',
    candidate: goldenLikeCandidate(),
    createdAt: new Date('2026-10-20T01:00:00.000Z'),
    finishedAt: null,
    reviewTimes: [],
    retryCount: 0,
  });

  it('按 run 合计：分子分母可逐条数出', () => {
    expect(metrics.totals.expected).toBe(23);
    expect(metrics.totals.extracted).toBe(21);
    expect(metrics.totals.unknown).toBe(1);
    expect(metrics.totals.conflict).toBe(1);
  });

  it('按岗位：岗位 A 与岗位 B 各自独立计数', () => {
    const jobA = metrics.scopes.find((s) => s.key === 'job-A-3301A01');
    expect(jobA).toMatchObject({ expected: 7, extracted: 6, conflict: 1, unknown: 0 });
    const jobB = metrics.scopes.find((s) => s.key === 'job-B-3301A02');
    expect(jobB).toMatchObject({ expected: 8, extracted: 7, unknown: 1, conflict: 0 });
    const announcement = metrics.scopes.find((s) => s.key === 'announcement');
    expect(announcement).toMatchObject({ expected: 8, extracted: 8 });
  });

  it('高影响证据覆盖率：分子=有证据高影响字段数，分母=应有高影响字段数', () => {
    expect(metrics.totals.highImpactEvidenced).toBe(22);
    expect(metrics.totals.highImpactExpected).toBe(22);
    const coverage = metrics.ratios.find(
      (r) => r.key === 'highImpactEvidenceCoverage',
    )!;
    expect(coverage.numerator).toBe(22);
    expect(coverage.denominator).toBe(22);
    expect(coverage.value).toBe(1);
    expect(coverage.formula).toContain('有证据高影响字段数');
  });

  it('每个比例同时给出分子、分母与公式；完整性 = 21/23', () => {
    const completeness = metrics.ratios.find((r) => r.key === 'completeness')!;
    expect(completeness.numerator).toBe(21);
    expect(completeness.denominator).toBe(23);
    expect(completeness.value).toBeCloseTo(21 / 23, 10);
    expect(completeness.formula).toContain('extracted / expected');
  });

  it('人工采用率：分子=(adopt+edit)，分母=有决策字段数；无决策时值为 null 而非 0', () => {
    const adoption = metrics.ratios.find((r) => r.key === 'humanAdoptionRate')!;
    expect(adoption.numerator).toBe(0);
    expect(adoption.denominator).toBe(0);
    expect(adoption.value).toBeNull();
    expect(adoption.formula).toContain('人工采用率不是准确率');
  });

  it('缺少时间戳显示未记录：totalDurationMs=null（finishedAt 缺失），不补零', () => {
    expect(metrics.timing.totalDurationMs).toBeNull();
    expect(metrics.timing.reviewDurationMs).toBeNull();
    expect(metrics.timing.retryCount).toBe(0);
  });

  it('时间可用时给出总耗时与人工审核耗时', () => {
    const withTime = computeExportMetrics({
      runId: 'run-1',
      status: 'published',
      parserVersion: 'v1',
      candidate: goldenLikeCandidate(),
      createdAt: new Date('2026-10-20T01:00:00.000Z'),
      finishedAt: new Date('2026-10-20T02:00:00.000Z'),
      reviewTimes: [
        new Date('2026-10-20T01:30:00.000Z'),
        new Date('2026-10-20T01:50:00.000Z'),
      ],
      retryCount: 2,
    });
    expect(withTime.timing.totalDurationMs).toBe(3600_000);
    expect(withTime.timing.reviewDurationMs).toBe(20 * 60_000);
    expect(withTime.timing.retryCount).toBe(2);
  });

  it('datasetMark 来自已发布目录载荷；未发布为 unmarked', () => {
    expect(metrics.datasetMark).toBe('unmarked');
    expect(metrics.sourceHost).toBe('');
    const published = computeExportMetrics({
      runId: 'run-1',
      status: 'published',
      parserVersion: 'v1',
      candidate: goldenLikeCandidate(),
      publishedPayload: {
        dataset: 'test',
        announcement: { id: 'a' },
        version: { id: 'v' },
      },
      sourceOfficialUrl: 'https://www.example.gov.cn/test/wb-notice',
    });
    expect(published.datasetMark).toBe('test');
    expect(published.sourceHost).toBe('www.example.gov.cn');
    expect(published.isExampleSource).toBe(true);
  });
});

describe('computeScopeMetrics：人工决策计数', () => {
  it('adopt/edit/reject/pending 与人工修改字段数（=edit）', () => {
    const decision = (
      action: 'adopt' | 'edit' | 'reject' | 'pending',
    ): CandidateField['decision'] => ({
      action,
      reason: '测试',
      operatorId: 'r1',
      decidedAt: '2026-10-20T00:00:00.000Z',
    });
    const fields: CandidateField[] = [
      jobField('job_code', 'A01', 'job-A', { decision: decision('adopt') }),
      jobField('major', '语文', 'job-A', { decision: decision('edit') }),
      jobField('stage', '初中', 'job-A', { decision: decision('reject') }),
      jobField('subject', '语文', 'job-A', { decision: decision('pending') }),
      jobField('headcount', '2', 'job-A'),
    ];
    const m = computeScopeMetrics('job-A', fields);
    expect(m.adopt).toBe(1);
    expect(m.edit).toBe(1);
    expect(m.reject).toBe(1);
    expect(m.pending).toBe(1);
    expect(m.humanModified).toBe(1);
  });
});
