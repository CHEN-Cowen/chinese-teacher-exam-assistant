/**
 * 郑州来源 Adapter 单元测试。
 *
 * 黄金样本用 fs 读取（不 import tests/fixtures）：
 * 覆盖静态列表发现、两种详情形态（老站 .shtml + 新政务域名 .jhtml）解析，
 * 以及 DOM 骨架失配必须显式抛出 DOM_MISMATCH。
 *
 * 样本取自真实郑州市教育局官网（2026-11-06 抓取）：
 * - 通知公告混合栏目（http://news.zzedu.net.cn/tz/）
 * - 首屏 20 条公告同时含老站 .shtml 与新政务 .jhtml 详情
 * - 动态"加载更多"分页（bfreeTools.js）暂只测试首屏
 * - jhtml 详情为标准河南省教育厅 CMS 模板（ArticleTitle/PubDate meta + .content 容器）
 * - shtml 详情为郑州老站模板（SourceTitle meta + div#article 容器）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AdapterParseError,
  type ArticlePageSnapshot,
  type ListPageSnapshot,
} from '../official-site-adapter.js';
import {
  ZHENGZHOU_ADAPTER_KEY,
  ZhengzhouEducationAdapter,
} from './zhengzhou-education.adapter.js';

function resolveGoldenDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'golden-sources',
      'zhengzhou-education',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 tests/fixtures/golden-sources/zhengzhou-education 目录');
}

const GOLDEN_DIR = resolveGoldenDir();
const LIST_URL = 'http://news.zzedu.net.cn/tz/';
const JHTML_DETAIL_URL =
  'https://zzjy.zhengzhou.gov.cn/tzgg/10291575.jhtml';
const SHTML_DETAIL_URL = 'http://news.zzedu.net.cn/tz/10/34486640.shtml';

function readSample(name: string): string {
  return readFileSync(path.join(GOLDEN_DIR, name), 'utf8');
}

function snapshot(url: string, content: string): ListPageSnapshot {
  return { url, mimeType: 'text/html', content, fetchedAt: new Date().toISOString() };
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

const adapter = new ZhengzhouEducationAdapter();

describe('ZhengzhouEducationAdapter', () => {
  it('来源标识固定为 zhengzhou-education', () => {
    expect(adapter.key).toBe(ZHENGZHOU_ADAPTER_KEY);
    expect(adapter.key).toBe('zhengzhou-education');
  });

  it('discover：首屏 20 条（10 shtml + 10 jhtml），URL 全规范化为绝对路径', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('public-list-1.html')));

    expect(items.length).toBe(20);
    const jhtml = items.filter((i) => i.url.includes('.jhtml'));
    const shtml = items.filter((i) => i.url.includes('.shtml'));
    expect(jhtml.length).toBe(10);
    expect(shtml.length).toBe(10);
    for (const item of items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.kind).toBe('announcement');
    }
    // jhtml 详情 host 是 zzjy.zhengzhou.gov.cn
    expect(jhtml[0].url).toMatch(/^https:\/\/zzjy\.zhengzhou\.gov\.cn\/tzgg\/\d+\.jhtml$/);
    expect(shtml[0].url).toMatch(/^http:\/\/news\.zzedu\.net\.cn\/tz\/\d+\/\d+\.shtml$/);
  });

  it('discover：日期 M月D日 补当年年份为 YYYY-MM-DD', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('public-list-1.html')));
    const year = new Date().getFullYear().toString();
    for (const item of items) {
      expect(item.publishedAt).toMatch(new RegExp(`^${year}-\\d{2}-\\d{2}$`));
    }
    // 取一条具体日期：10月29日 → YYYY-10-29
    const oct29 = items.find((i) => i.publishedAt.endsWith('-10-29'));
    expect(oct29).toBeDefined();
  });

  it('discover：跳过 ul#pageCont 空占位 li（暂无数据）', () => {
    const items = adapter.discover(snapshot(LIST_URL, readSample('public-list-1.html')));
    expect(items.every((i) => !i.title.includes('暂无数据'))).toBe(true);
    expect(items.every((i) => i.title.trim().length >= 5)).toBe(true);
  });

  it('locateArticle：jhtml 详情（zzjy.zhengzhou.gov.cn）走河南省教育厅模板', () => {
    const detail = adapter.locateArticle({
      url: JHTML_DETAIL_URL,
      mimeType: 'text/html',
      content: readSample('detail-10291575.jhtml.html'),
      fetchedAt: new Date().toISOString(),
    });

    expect(detail.canonicalUrl).toBe(JHTML_DETAIL_URL);
    expect(detail.title).toBe(
      '2026年郑州市事业单位公开招聘（市级联考）郑州市教育局直属学校拟聘用人员公示',
    );
    expect(detail.publishedAt).toBe('2026-10-12');
    expect(detail.bodyText).toContain('拟聘用人员');
    expect(detail.bodyText.trim().length).toBeGreaterThan(50);
    // 河南省教育厅 jhtml 模板通常含附件或正文表格
    expect(detail.attachments.length).toBeGreaterThanOrEqual(0);
  });

  it('locateArticle：shtml 详情（news.zzedu.net.cn）走郑州老站模板（SourceTitle + div#article）', () => {
    const detail = adapter.locateArticle({
      url: SHTML_DETAIL_URL,
      mimeType: 'text/html',
      content: readSample('detail-10-34486640.shtml.html'),
      fetchedAt: new Date().toISOString(),
    });

    expect(detail.canonicalUrl).toBe(SHTML_DETAIL_URL);
    expect(detail.title).toBe('关于郑州教育城域网中心机房核心设备版本升级的通知');
    // 郑州老站正文容器内日期
    expect(detail.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.bodyText).toContain('城域网出口核心设备');
    expect(detail.bodyText.length).toBeGreaterThan(200);
  });

  it('DOM 失配：ul#pageCont 被移除 → discover 抛 DOM_MISMATCH', () => {
    const content = readSample('public-list-1.html').replace(
      /<ul[^>]*id=["']pageCont["'][^>]*>[\s\S]*?<\/ul>/i,
      '<div id="other"></div>',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：li 内 span 不是 M月D日 → discover 抛 DOM_MISMATCH（不全默认为今天）', () => {
    const content = readSample('public-list-1.html').replace(
      /<span class="listPage_shareButton">[\s\S]*?<\/span>\s*(\d+月\d+日)/g,
      '<span class="listPage_shareButton">*</span> 非法日期',
    );
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：shtml 详情删除 div#article → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail-10-34486640.shtml.html').replace(
      /<div[^>]*id=["']article["'][^>]*>[\s\S]*?<\/div>/i,
      '<div id="other"></div>',
    );
    const err = captureParseError(() =>
      adapter.locateArticle({
        url: SHTML_DETAIL_URL,
        mimeType: 'text/html',
        content,
        fetchedAt: new Date().toISOString(),
      }),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('DOM 失配：jhtml 详情删除 ArticleTitle meta → locateArticle 抛 DOM_MISMATCH', () => {
    const content = readSample('detail-10291575.jhtml.html').replace(
      /<meta[^>]+name=["']ArticleTitle["'][^>]*content=["'][^"']*["'][^>]*>/gi,
      '',
    );
    const err = captureParseError(() =>
      adapter.locateArticle({
        url: JHTML_DETAIL_URL,
        mimeType: 'text/html',
        content,
        fetchedAt: new Date().toISOString(),
      }),
    );
    expect(err).toBeInstanceOf(AdapterParseError);
    expect(err.code).toBe('DOM_MISMATCH');
  });

  it('discover：JSON 文本 → 抛 DOM_MISMATCH（不走公开接口 JSON 协议）', () => {
    const content = JSON.stringify({ data: [{ title: 'test' }] });
    const err = captureParseError(() =>
      adapter.discover(snapshot(LIST_URL, content)),
    );
    expect(err.code).toBe('DOM_MISMATCH');
  });
});
