/**
 * S5 任务 3 打样：南京、丽水独立清单对账。
 *
 * 清单在 tests/fixtures/source-checklists/，由人工按官方栏目分页建立，
 * 不从本测试的发现结果生成。本测试只验证：
 * 1. 冻结清单能被 reconcileSource 接受；
 * 2. 适配器在同一批官方分页快照上的发现结果，与清单按 URL+标题+日期匹配。
 *
 * 快照不进入黄金样本，放在仓库外，避免覆盖已核验 fixture。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LishuiEducationAdapter } from './adapters/lishui-education.adapter.js';
import { NanjingEducationAdapter } from './adapters/nanjing-education.adapter.js';
import {
  reconcileSource,
  type SourceChecklist,
  type SourceObservation,
} from './source-reconciliation.js';

const SNAPSHOT_ROOT =
  'C:/Users/cchen/AppData/Local/Temp/wb-cap/checklist-2026-10-26';
const CHECKLIST_ROOT = path.resolve(
  import.meta.dirname,
  '../../../tests/fixtures/source-checklists',
);

function readChecklist(name: string): SourceChecklist {
  return JSON.parse(
    readFileSync(path.join(CHECKLIST_ROOT, name), 'utf8'),
  ) as SourceChecklist;
}

function discoverAll(
  adapter: {
    discover(input: {
      url: string;
      content: string;
      contentType: string;
    }): Array<{ url: string; title: string; publishedAt: string }>;
  },
  pages: Array<{ url: string; content: string; contentType: string }>,
): SourceObservation[] {
  return pages.flatMap((page) =>
    adapter.discover(page).map((item) => ({
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      outcome: 'discovered' as const,
      // 本次只对账栏目发现，未逐条抓正文和附件，不能声称材料完整。
      materialComplete: false,
    })),
  );
}

describe('S5 南京与丽水独立清单打样', () => {
  it('冻结清单不从系统结果生成，且取消、延期进入分母', () => {
    for (const name of ['nanjing-education.json', 'lishui-education.json']) {
      const checklist = readChecklist(name);
      expect(checklist.verification).toBe('pending');
      expect(
        checklist.entries.every((entry) => entry.reason.trim().length > 0),
      ).toBe(true);
      expect(
        checklist.entries.some(
          (entry) =>
            /取消|核减/.test(entry.title) && entry.disposition === 'target',
        ),
      ).toBe(true);
    }
    expect(
      readChecklist('lishui-education.json').entries.some(
        (entry) =>
          entry.title.includes('推迟') && entry.disposition === 'target',
      ),
    ).toBe(true);
  });

  it('南京 2026 窗口内目标公告全部被栏目解析发现，材料完整率不输出', () => {
    const checklist = readChecklist('nanjing-education.json');
    const pages = Array.from({ length: 7 }, (_value, index) => ({
      url:
        index === 0
          ? 'https://edu.nanjing.gov.cn/bsfw/zpzk/index.html'
          : `https://edu.nanjing.gov.cn/bsfw/zpzk/index_${index}.html`,
      content: readFileSync(
        path.join(SNAPSHOT_ROOT, 'nanjing', `page-${index + 1}.html`),
        'utf8',
      ),
      contentType: 'text/html',
    }));
    expect(
      pages.every((page) => existsSync(page.url) || page.content.length > 0),
    ).toBe(true);
    const result = reconcileSource(
      checklist,
      discoverAll(new NanjingEducationAdapter(), pages),
    );
    expect(result.recall).toEqual({
      numerator: 16,
      denominator: 16,
      ratio: null,
    });
    expect(result.rows.every((row) => row.outcome === 'discovered')).toBe(true);
    expect(result.materialCompleteness).toEqual({
      numerator: 0,
      denominator: 16,
      ratio: null,
    });
    expect(result.excluded).toHaveLength(13);
  });

  it('丽水 2026 窗口内目标公告全部被公开接口解析发现，材料完整率不输出', () => {
    const checklist = readChecklist('lishui-education.json');
    const summary = JSON.parse(
      readFileSync(path.join(SNAPSHOT_ROOT, 'capture-summary.json'), 'utf8'),
    ) as {
      sources: Array<{ sourceKey: string; listUrl: string }>;
    };
    const listUrl = summary.sources.find(
      (source) => source.sourceKey === 'lishui-education',
    )?.listUrl;
    expect(listUrl).toBeTruthy();
    const pages = Array.from({ length: 13 }, (_value, index) => {
      const url = new URL(listUrl!);
      if (index > 0)
        url.searchParams.set(
          'paramJson',
          JSON.stringify({ pageNo: index + 1, pageSize: '10' }),
        );
      return {
        url: url.href,
        content: readFileSync(
          path.join(SNAPSHOT_ROOT, 'lishui', `page-${index + 1}.json`),
          'utf8',
        ),
        contentType: 'application/json',
      };
    });
    const result = reconcileSource(
      checklist,
      discoverAll(new LishuiEducationAdapter(), pages),
    );
    expect(result.recall).toEqual({
      numerator: 8,
      denominator: 8,
      ratio: null,
    });
    expect(result.rows.every((row) => row.outcome === 'discovered')).toBe(true);
    expect(result.materialCompleteness.numerator).toBe(0);
    expect(result.excluded).toHaveLength(20);
  });
});
