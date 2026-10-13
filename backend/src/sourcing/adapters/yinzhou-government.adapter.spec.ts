/**
 * 鄞州来源 Adapter 单元测试（v7.2 工作包 3）。
 *
 * 黄金样本在运行时用 fs 读取（不 import tests/fixtures）：
 * 鄞州为县区级政府信息公开结构（#announcement-list / .title-box / .content-box），
 * 验证与其他来源不同的选择器，以及 DOM 失配必须显式抛出 DOM_MISMATCH。
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
  YINZHOU_ADAPTER_KEY,
  YinzhouGovernmentAdapter,
} from './yinzhou-government.adapter.js';

/** 从 cwd 逐级向上查找含黄金样本的目录（测试通常从 backend/ 运行） */
function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'yinzhou',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/yinzhou 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'https://www.nbyz.gov.cn/col/col1229356789/index.html';
const ITEM_URL =
  'https://www.nbyz.gov.cn/col/col1229356789/art/2026/art_9f8e7d6c5b4a.html';
const DETAIL_URL = ITEM_URL;
const ANN_TITLE = '2026学年宁波市鄞州区教育系统招聘事业编制教师预告（测试样本）';

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

const adapter = new YinzhouGovernmentAdapter();

describe('YinzhouGovernmentAdapter', () => {
  it('来源标识固定为 yinzhou-government', () => {
    expect(adapter.key).toBe(YINZHOU_ADAPTER_KEY);
    expect(adapter.key).toBe('yinzhou-government');
  });

  it('discover：解析出 1 条，标题/日期/详情绝对 URL/形态正确', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('list.html')));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe(ANN_TITLE);
    expect(items[0].publishedAt).toBe('2026-06-20');
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
    expect(detail.publishedAt).toBe('2026-06-20');
    expect(detail.bodyText).toContain('鄞州区');
    expect(detail.bodyText).toContain('招聘');
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0].name).toBe('岗位计划表.xls');
    expect(detail.attachments[0].url).toBe(
      'https://www.nbyz.gov.cn/module/download/downfile.jsp?filename=yztest456.xls',
    );
  });

  it('DOM 失配：列表页删除 ul#announcement-list 容器 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<ul[^>]*id="announcement-list"[^>]*>[\s\S]*?<\/ul>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('空结果即故障：容器存在但无条目 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<ul[^>]*id="announcement-list"[^>]*>[\s\S]*?<\/ul>/i,
      '<ul id="announcement-list"></ul>',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 div.content-box → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\bcontent-box\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 div.title-box h1 → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<h1>[\s\S]*?<\/h1>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });
});
