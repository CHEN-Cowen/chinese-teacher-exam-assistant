/**
 * 北京人社局「事业单位公开招聘」来源 Adapter 单元测试。
 *
 * 黄金样本取自真实官网（2026-11-20 抓取）：
 * - 首屏 12 条综合事业单位公告，其中 6 条为教育/学校/教师相关；
 * - 详情页为 TRS CMS：meta ArticleTitle/PubDate + div.view 正文。
 *
 * 重点验证：综合栏目按标题过滤非教师岗位、详情正文回退到 .view，
 * 以及 DOM 骨架失配必须显式抛出 DOM_MISMATCH。
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
  BEIJING_RSJ_ADAPTER_KEY,
  BeijingRsjRecruitmentAdapter,
} from './beijing-rsj.adapter.js';

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'beijing-rsj',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/beijing-rsj 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'https://rsj.beijing.gov.cn/xxgk/gkzp/';
const DETAIL_URL =
  'https://rsj.beijing.gov.cn/xxgk/gkzp/202611/t20261105_4933871.html';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function listSnapshot(url: string, content: string): ListPageSnapshot {
  return {
    url,
    mimeType: 'text/html',
    content,
    fetchedAt: new Date().toISOString(),
  };
}

function articleSnapshot(url: string, content: string): ArticlePageSnapshot {
  return {
    url,
    mimeType: 'text/html',
    content,
    fetchedAt: new Date().toISOString(),
  };
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

describe('BeijingRsjRecruitmentAdapter', () => {
  const adapter = new BeijingRsjRecruitmentAdapter();

  it('使用稳定 adapterKey', () => {
    expect(adapter.key).toBe(BEIJING_RSJ_ADAPTER_KEY);
    expect(BEIJING_RSJ_ADAPTER_KEY).toBe('beijing-rsj-recruitment');
  });

  it('只保留教育/学校/教师相关公告，过滤医院/广电/剧院', () => {
    const items = adapter.discover(
      listSnapshot(LIST_URL, readSample('public-list-1.html')),
    );
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.url).toMatch(
        /\/xxgk\/gkzp\/\d{6}\/t\d{8}_\d+\.html/,
      );
      expect(item.title).toMatch(/(教育|教师|学校|大学|学院|教委)/);
    }
    expect(items.map((item) => item.title)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('医院')]),
    );
    expect(items.map((item) => item.title)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('广播电视台')]),
    );
  });

  it('列表骨架失配时抛 DOM_MISMATCH，不静默返回 0 条', () => {
    const error = captureParseError(() =>
      adapter.discover(listSnapshot(LIST_URL, '<html><body>无列表</body></html>')),
    );
    expect(error.code).toBe('DOM_MISMATCH');
  });

  it('解析详情 meta 与 div.view 正文', () => {
    const article = adapter.locateArticle(
      articleSnapshot(DETAIL_URL, readSample('public-detail.html')),
    );
    expect(article.title).toBe(
      '北京第二实验学校面向2027年应届毕业生和社会人员公开招聘公告',
    );
    expect(article.publishedAt).toBe('2026-11-05');
    expect(article.bodyText.length).toBeGreaterThan(50);
  });

  it('详情缺少官方 meta 时抛 DOM_MISMATCH', () => {
    const error = captureParseError(() =>
      adapter.locateArticle(
        articleSnapshot(DETAIL_URL, '<html><body><div class="view">无元数据</div></body></html>'),
      ),
    );
    expect(error.code).toBe('DOM_MISMATCH');
  });
});
