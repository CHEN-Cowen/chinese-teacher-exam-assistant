/**
 * 宁波来源 Adapter 单元测试（v7.2 工作包 3）。
 *
 * 黄金样本在运行时用 fs 读取（不 import tests/fixtures）：
 * 宁波站为 table 列表结构，验证与杭州不同的选择器，以及 DOM 失配必须显式抛出
 * DOM_MISMATCH（绝不静默返回 0 条）。
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
  NINGBO_ADAPTER_KEY,
  NingboEducationAdapter,
} from './ningbo-education.adapter.js';

/** 从 cwd 逐级向上查找含黄金样本的目录（测试通常从 backend/ 运行） */
function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'ningbo',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/ningbo 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'https://jyj.ningbo.gov.cn/col/col1229143/index.html';
const ITEM_URL = 'https://jyj.ningbo.gov.cn/col/t20090101/c202610/t123456.shtml';
const DETAIL_URL = 'https://jyj.ningbo.gov.cn/art/2026/7/15/art_123456.html';
const ANN_TITLE = '宁波市教育局直属学校公开招聘教师公告（测试样本）';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function snapshot(url: string, content: string): ListPageSnapshot {
  return {
    url,
    mimeType: 'text/html',
    content,
    fetchedAt: new Date().toISOString(),
  };
}

function asArticle(snap: ListPageSnapshot): ArticlePageSnapshot {
  return snap;
}

/** 断言回调抛出 AdapterParseError，返回该错误以便检查 code */
function captureParseError(fn: () => unknown): AdapterParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdapterParseError) return error;
    throw error;
  }
  throw new Error('期望抛出 AdapterParseError，但调用成功返回（疑似静默降级）');
}

const adapter = new NingboEducationAdapter();

describe('NingboEducationAdapter', () => {
  it('来源标识固定为 ningbo-education', () => {
    expect(adapter.key).toBe(NINGBO_ADAPTER_KEY);
    expect(adapter.key).toBe('ningbo-education');
  });

  it('discover：解析出 1 条，标题/日期/详情绝对 URL/形态正确', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('list.html')));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe(ANN_TITLE);
    expect(items[0].publishedAt).toBe('2026-07-15');
    expect(items[0].url).toBe(ITEM_URL);
    expect(items[0].url.startsWith('https://')).toBe(true);
    expect(items[0].kind).toBe('announcement');
  });

  it('locateArticle：标题/日期/正文/附件（相对路径已解析为绝对 URL）', () => {
    const detail = adapter.locateArticle(
      asArticle(snapshot(DETAIL_URL, readSample('detail.html'))),
    );

    expect(detail.canonicalUrl).toBe(DETAIL_URL);
    expect(detail.title).toBe(ANN_TITLE);
    expect(detail.publishedAt).toBe('2026-07-15');
    expect(detail.bodyText).toContain('宁波市教育局');
    expect(detail.bodyText).toContain('招聘');
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0].name).toBe('招聘岗位表.doc');
    expect(detail.attachments[0].url).toBe(
      'https://jyj.ningbo.gov.cn/module/download/downfile.jsp?filename=test123.doc',
    );
  });

  it('DOM 失配：列表页删除 table.news-table 容器 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<table[^>]*class="[^"]*\bnews-table\b[^"]*"[^>]*>[\s\S]*?<\/table>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：列表行缺少 td.news-date 节点 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<td[^>]*class="[^"]*\bnews-date\b[^"]*"[^>]*>[\s\S]*?<\/td>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('空结果即故障：表格存在但无新闻行 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<tr[^>]*class="[^"]*\bnews-row\b[^"]*"[^>]*>[\s\S]*?<\/tr>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 div.xl_con → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\bxl_con\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 div.xl_info（无日期）→ locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\bxl_info\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });
});
