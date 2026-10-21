/**
 * 南京来源 Adapter 单元测试。
 *
 * 黄金样本用 fs 读取（不 import tests/fixtures）：
 * 覆盖列表页/正文页解析，以及 DOM 骨架失配必须显式抛出 DOM_MISMATCH。
 *
 * 样本取自真实南京市教育局官网（2026-10-21 抓取），列表页含 2026-01 各区公告。
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
  NANJING_ADAPTER_KEY,
  NanjingEducationAdapter,
} from './nanjing-education.adapter.js';

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'nanjing',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/nanjing 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'https://edu.nanjing.gov.cn/bsfw/zpzk/index_1.html';
const DETAIL_URL =
  'https://edu.nanjing.gov.cn/bsfw/zpzk/202601/t20260109_5761685.html';
const ANN_TITLE = '南京市玄武区教育局所属学校2026年公开招聘教师公告';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function snapshot(url: string, content: string): ListPageSnapshot {
  return { url, mimeType: 'text/html', content, fetchedAt: new Date().toISOString() };
}

function asArticle(snap: ListPageSnapshot): ArticlePageSnapshot {
  return snap;
}

function captureParseError(fn: () => unknown): AdapterParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdapterParseError) return error;
    throw error;
  }
  throw new Error('期望抛出 AdapterParseError，但调用成功返回（疑似静默降级）');
}

const adapter = new NanjingEducationAdapter();

describe('NanjingEducationAdapter', () => {
  it('来源标识固定为 nanjing-education', () => {
    expect(adapter.key).toBe(NANJING_ADAPTER_KEY);
    expect(adapter.key).toBe('nanjing-education');
  });

  it('discover：解析出多条，含玄武区公告，标题/日期/绝对 URL 正确', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('list.html')));

    expect(items.length).toBeGreaterThan(5);
    const xuanwu = items.find((i) => i.title.includes('玄武区'));
    expect(xuanwu).toBeDefined();
    expect(xuanwu!.title).toBe(ANN_TITLE);
    expect(xuanwu!.publishedAt).toBe('2026-01-09');
    expect(xuanwu!.url).toBe(DETAIL_URL);
    expect(xuanwu!.url.startsWith('https://')).toBe(true);
    expect(xuanwu!.kind).toBe('announcement');
  });

  it('discover：相对路径统一解析为绝对 URL（edu.nanjing.gov.cn）', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('list.html')));
    for (const item of items) {
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });

  it('locateArticle：标题/日期/正文/附件（PDF 相对路径解析为绝对 URL）', () => {
    const detail = adapter.locateArticle(
      asArticle(snapshot(DETAIL_URL, readSample('detail.html'))),
    );

    expect(detail.canonicalUrl).toBe(DETAIL_URL);
    expect(detail.title).toBe(ANN_TITLE);
    expect(detail.publishedAt).toBe('2026-01-09');
    expect(detail.bodyText).toContain('玄武区教育局');
    expect(detail.bodyText).toContain('公开招聘');
    // 玄武公告含 4 个 PDF 附件（岗位信息表1/2、专业目录、承诺书）
    expect(detail.attachments.length).toBeGreaterThanOrEqual(4);
    const first = detail.attachments[0];
    expect(first.url).toMatch(/\.pdf$/i);
    expect(first.url.startsWith('https://edu.nanjing.gov.cn/')).toBe(true);
    // 附件名去掉序号前缀，不含「1.」
    expect(first.name).not.toMatch(/^\d+\./);
    expect(first.name).toContain('岗位信息表');
  });

  it('DOM 失配：列表页删除 list-right-con 容器 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<div[^>]*class="[^"]*\blist-right-con\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 .doctitle → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\bdoctitle\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 .doccontent → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\bdoccontent\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle(asArticle(snapshot(DETAIL_URL, content))),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });
});
