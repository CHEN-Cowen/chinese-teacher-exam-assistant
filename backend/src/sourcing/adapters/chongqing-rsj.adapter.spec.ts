/**
 * 重庆人社局「事业单位公开招聘」来源 Adapter 单元测试。
 *
 * 黄金样本取自真实官网（2026-11-20 抓取）：
 * - 首屏 20 条综合事业单位公告，其中 9 条为教育/学校/高校/党校相关；
 * - 详情页为 TRS 变体：meta ArticleTitle/PubDate + div.xl-article；
 * - 岗位一览表不在正文 DOM，而在脚本变量 hasFJ 中（必须补抓，否则漏岗位表）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type ListPageSnapshot,
} from '../official-site-adapter.js';
import {
  CHONGQING_RSJ_ADAPTER_KEY,
  ChongqingRsjRecruitmentAdapter,
} from './chongqing-rsj.adapter.js';

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'chongqing-rsj',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/chongqing-rsj 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL =
  'https://rlsbj.cq.gov.cn/zwxx_182/sydw/sydwgkzp2026/';
const DETAIL_URL =
  'https://rlsbj.cq.gov.cn/zwxx_182/sydw/sydwgkzp2026/202610/t20261020_16262763.html';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function listSnapshot(url: string, content: string): ListPageSnapshot {
  return { url, mimeType: 'text/html', content, fetchedAt: new Date().toISOString() };
}

function articleSnapshot(url: string, content: string): ArticlePageSnapshot {
  return { url, mimeType: 'text/html', content, fetchedAt: new Date().toISOString() };
}

function captureParseError(fn: () => unknown): AdapterParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdapterParseError) return error;
    throw error;
  }
  throw new Error('预期抛出 AdapterParseError，但未抛出');
}

describe('ChongqingRsjRecruitmentAdapter', () => {
  const adapter = new ChongqingRsjRecruitmentAdapter();

  it('使用稳定 adapterKey', () => {
    expect(adapter.key).toBe(CHONGQING_RSJ_ADAPTER_KEY);
    expect(CHONGQING_RSJ_ADAPTER_KEY).toBe('chongqing-rsj-recruitment');
  });

  it('只保留教育/学校/高校/党校相关公告', () => {
    const items = adapter.discover(
      listSnapshot(LIST_URL, readSample('public-list-1.html')),
    );
    expect(items).toHaveLength(9);
    for (const item of items) {
      expect(item.url).toMatch(
        /\/zwxx_182\/sydw\/sydwgkzp\d{4}\/\d{6}\/t\d{8}_\d+\.html/,
      );
      expect(item.title).toMatch(/(教育|学校|大学|学院|党校|公费师范)/);
    }
    expect(items.map((item) => item.title)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('畜牧科学院')]),
    );
    expect(items.map((item) => item.title)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('气象部门')]),
    );
  });

  it('列表骨架失配时抛 DOM_MISMATCH', () => {
    const error = captureParseError(() =>
      adapter.discover(listSnapshot(LIST_URL, '<html><body>无列表</body></html>')),
    );
    expect(error.code).toBe('DOM_MISMATCH');
  });

  it('解析正文并从 hasFJ 补全岗位表附件', () => {
    const article = adapter.locateArticle(
      articleSnapshot(DETAIL_URL, readSample('public-detail.html')),
    );
    expect(article.title).toContain('万州区教育事业单位');
    expect(article.publishedAt).toBe('2026-10-20');
    expect(article.bodyText.length).toBeGreaterThan(100);
    const names = article.attachments.map((item) => item.name).join('|');
    expect(names).toContain('岗位一览表');
    expect(names).toContain('专业参考目录');
    expect(article.attachments).toHaveLength(2);
    for (const attachment of article.attachments) {
      expect(attachment.url).toMatch(
        /^https:\/\/rlsbj\.cq\.gov\.cn\/zwxx_182\/sydw\/sydwgkzp\d{4}\/\d{6}\/P\d+\.xlsx$/,
      );
    }
  });

  it('详情缺少官方 meta 时抛 DOM_MISMATCH', () => {
    const error = captureParseError(() =>
      adapter.locateArticle(
        articleSnapshot(DETAIL_URL, '<html><body><div class="xl-article">无元数据</div></body></html>'),
      ),
    );
    expect(error.code).toBe('DOM_MISMATCH');
  });
});
