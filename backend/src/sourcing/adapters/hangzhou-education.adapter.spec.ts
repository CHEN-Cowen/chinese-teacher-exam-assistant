/**
 * 杭州来源 Adapter 单元测试（v7.2 工作包 3，唯一来源闭环样例）。
 *
 * 黄金样本在运行时用 fs 读取（不 import tests/fixtures）：
 * 覆盖列表页/正文页解析，以及 DOM 骨架失配必须显式抛出 DOM_MISMATCH
 * （绝不静默返回 0 条）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AdapterParseError,
  type DownloadedSnapshot,
} from '../official-site-adapter.js';
import {
  HANGZHOU_SOURCE_ID,
  HangzhouEducationAdapter,
} from './hangzhou-education.adapter.js';

/** 从 cwd 逐级向上查找含黄金样本的目录（测试通常从 backend/ 运行） */
function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'hangzhou',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/hangzhou 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'https://edu.hangzhou.gov.cn/col/col123/index.html';
const DETAIL_URL =
  'https://edu.hangzhou.gov.cn/art/2026/10/9/art_1229391906_59012345.html';
const ANN_TITLE = '2026年10月杭州市教育局所属事业单位公开招聘教师公告（测试样本）';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function snapshot(url: string, content: string): DownloadedSnapshot {
  return {
    url,
    mimeType: 'text/html',
    content,
    fetchedAt: new Date().toISOString(),
  };
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

const adapter = new HangzhouEducationAdapter();

describe('HangzhouEducationAdapter', () => {
  it('来源标识固定为 hangzhou-education', () => {
    expect(adapter.sourceId).toBe(HANGZHOU_SOURCE_ID);
  });

  it('listItems：解析出 1 条，标题/日期/详情绝对 URL 正确', () => {
    const items = adapter.listItems(snapshot(LIST_URL, readSample('list.html')));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe(ANN_TITLE);
    expect(items[0].publishedAt).toBe('2026-10-09');
    expect(items[0].detailUrl).toBe(DETAIL_URL);
    expect(items[0].detailUrl.startsWith('https://')).toBe(true);
  });

  it('parseDetail：标题/日期/正文/附件（相对路径已解析为绝对 URL）', () => {
    const detail = adapter.parseDetail(
      snapshot(DETAIL_URL, readSample('detail.html')),
    );

    expect(detail.title).toBe(ANN_TITLE);
    expect(detail.publishedAt).toBe('2026-10-09');
    expect(detail.bodyText).toContain('杭州市教育局');
    expect(detail.bodyText).toContain('招聘');
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0].name).toBe('岗位表.xlsx');
    expect(detail.attachments[0].url).toBe(
      'https://edu.hangzhou.gov.cn/art/2026/10/9/attach/0/bfd12345abcd.xlsx',
    );
  });

  it('DOM 失配：列表页删除 .news-list 容器 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<ul[^>]*class="news-list"[\s\S]*?<\/ul>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.listItems(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：列表条目缺少 .date 节点 → 抛 DOM_MISMATCH', () => {
    const content = readSample('list.html').replace(
      /<span[^>]*class="date"[^>]*>[\s\S]*?<\/span>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.listItems(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：正文页删除 .article-content → parseDetail 抛 DOM_MISMATCH', () => {
    const content = readSample('detail.html').replace(
      /<div[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const err = captureParseError(() =>
      adapter.parseDetail(snapshot(DETAIL_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });
});
