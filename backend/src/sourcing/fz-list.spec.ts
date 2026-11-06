import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverFjdzRecords,
  FJ_PAGE_WINDOWS,
  fjdzSearchPages,
  fjdzSearchRequest,
  isFjdzSearchUrl,
} from './fz-list.js';
import { FuzhouEducationAdapter } from './adapters/fuzhou-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'fuzhou-education',
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

// 采集脚本未写 manifest：列表 URL 为探测时实测的请求形态（query 承载全部
// 请求体参数），详情 URL 取自列表响应 chnldocurl。
const PAGE1_URL =
  'https://jyj.fuzhou.gov.cn/fjdzapp/search?channelid=229105&chnlid=47610&page=1';
const PAGE2_URL =
  'https://jyj.fuzhou.gov.cn/fjdzapp/search?channelid=229105&chnlid=47610&page=2';

describe('S5 N3 福州 fjdzapp/search：表单 POST 列表与正文附件离线回放', () => {
  it('首屏 JSON：15 条、日期/URL 规范、含招聘相关条目', () => {
    const page1 = readFixture('search-page1.json');
    const items = discoverFjdzRecords(PAGE1_URL, page1);
    expect(items).toHaveLength(15);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.fuzhou\.gov\.cn\/zwgk\/tzgg\/\d{6}\/t\d{8}_\d+\.htm$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    // 混合栏目：首屏为近期认定/公示条目，标题剥离后无残留标签
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
  });

  it('分页 URL 派生 POST 表单请求体，与官方抓包一致', () => {
    expect(isFjdzSearchUrl(PAGE1_URL)).toBe(true);
    expect(isFjdzSearchUrl('https://jyj.fuzhou.gov.cn/zwgk/tzgg/')).toBe(false);
    const request = fjdzSearchRequest(PAGE1_URL);
    expect(request.method).toBe('POST');
    expect(request.contentType).toBe('application/x-www-form-urlencoded');
    expect(request.body).toBe(
      'channelid=229105&classsql=chnlid%3D47610&sortfield=-docorderpri%2C-docreltime&classcol=publishyear&classsort=0&page=1&prepage=15',
    );
    // 后续页只替换 page 参数
    expect(fjdzSearchRequest(PAGE2_URL).body).toContain('page=2');
    expect(() =>
      fjdzSearchRequest('https://jyj.fuzhou.gov.cn/fjdzapp/search?channelid=229105'),
    ).toThrow(AdapterParseError);
  });

  it('后续页：窗口封顶 6 页；未登记 host 超预算显式失败', () => {
    const page1 = readFixture('search-page1.json');
    expect(FJ_PAGE_WINDOWS['jyj.fuzhou.gov.cn']).toBe(6);
    // 官方 178 页，已登记窗口：只生成第 2..6 页，不抛错
    const pages = fjdzSearchPages(PAGE1_URL, page1);
    expect(pages).toHaveLength(5);
    expect(pages[0]).toBe(PAGE2_URL);
    expect(
      new URL(pages.at(-1)!).searchParams.get('page'),
    ).toBe('6');
    // 未登记 host：超 20 页预算显式失败，不静默截断
    const otherHostUrl =
      'https://jyj.other.gov.cn/fjdzapp/search?channelid=1&chnlid=2&page=1';
    expect(() => fjdzSearchPages(otherHostUrl, page1)).toThrow(/窗口预算/);
    // 未登记 host 且总页数在预算内：按 pageCount 生成第 2..N 页
    expect(
      fjdzSearchPages(
        otherHostUrl,
        '{"error":false,"pageCount":3,"data":[{}]}',
      ),
    ).toHaveLength(2);
    // 非 fjdz JSON（HTML 列表页 / 其他接口）静默返回空数组，不误报结构漂移
    expect(fjdzSearchPages(PAGE1_URL, '<html/>')).toEqual([]);
    expect(
      fjdzSearchPages(PAGE1_URL, '{"success":true,"data":{"html":"<div/>"}}'),
    ).toEqual([]);
    // 后续页响应不再派生分页
    expect(
      fjdzSearchPages(PAGE2_URL, readFixture('search-page2.json')),
    ).toEqual([]);
  });

  it('第 2 页与首屏无重叠（衔接校验）', () => {
    const page2 = readFixture('search-page2.json');
    const first = new Set(
      discoverFjdzRecords(PAGE1_URL, readFixture('search-page1.json')).map(
        (item) => item.url,
      ),
    );
    const items = discoverFjdzRecords(PAGE2_URL, page2);
    expect(items).toHaveLength(15);
    expect(items.some((item) => first.has(item.url))).toBe(false);
    // 第 2 页首条即教师招聘拟聘公示（招聘相关条目持续滚动出现）
    expect(items[0]!.title).toContain('拟聘用人选公示');
    expect(items[0]!.publishedAt).toBe('2026-09-28');
  });

  it('空 data 或接口失败显式抛错（静默 0 条视为故障）', () => {
    expect(() =>
      discoverFjdzRecords(PAGE1_URL, '{"error":true,"info":"获取站点配置失败"}'),
    ).toThrow(/获取站点配置失败/);
    expect(() =>
      discoverFjdzRecords(
        PAGE1_URL,
        '{"error":false,"pageCount":178,"data":[]}',
      ),
    ).toThrow(AdapterParseError);
    expect(() => discoverFjdzRecords(PAGE1_URL, '<html/>')).toThrow(
      AdapterParseError,
    );
  });

  it('招聘公告详情：meta 标题/日期、article_content 正文与 4 个岗位表 pdf 附件', () => {
    const adapter = new FuzhouEducationAdapter();
    const article = adapter.locateArticle({
      url: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202603/t20260304_5291690.htm',
      mimeType: 'text/html',
      content: readFixture('detail-t20260304_5291690.htm.html'),
      fetchedAt: '2026-11-06T07:40:00.000Z',
    });
    expect(article.title).toBe(
      '福州市教育局关于2025-2026学年福州市直中小学幼儿园教师招聘的公告',
    );
    expect(article.publishedAt).toBe('2026-03-04');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.bodyText).toContain('招聘');
    expect(article.attachments).toHaveLength(4);
    expect(
      article.attachments.every((attachment) =>
        /^https:\/\/jyj\.fuzhou\.gov\.cn\/zwgk\/tzgg\/202603\/P0\d+\.pdf$/.test(
          attachment.url,
        ),
      ),
    ).toBe(true);
    expect(
      article.attachments.some((attachment) =>
        attachment.name.includes('岗位计划表'),
      ),
    ).toBe(true);
  });

  it('拟聘公示与名单类详情：附件相对路径展开且去重', () => {
    const adapter = new FuzhouEducationAdapter();
    const publicized = adapter.locateArticle({
      url: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202609/t20260928_5376361.htm',
      mimeType: 'text/html',
      content: readFixture('detail-t20260928_5376361.htm.html'),
      fetchedAt: '2026-11-06T07:40:00.000Z',
    });
    expect(publicized.title).toContain('拟聘用人选公示');
    expect(publicized.attachments).toHaveLength(2);
    expect(
      publicized.attachments.every((attachment) =>
        attachment.url.endsWith('.pdf'),
      ),
    ).toBe(true);
    const named = adapter.locateArticle({
      url: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202611/t20261105_5389939.htm',
      mimeType: 'text/html',
      content: readFixture('detail-t20261105_5389939.htm.html'),
      fetchedAt: '2026-11-06T07:40:00.000Z',
    });
    expect(named.title).toContain('教学名师认定人员名单');
    expect(named.publishedAt).toBe('2026-11-05');
    expect(named.attachments).toHaveLength(1);
    expect(named.attachments[0]!.url.endsWith('.xlsx')).toBe(true);
  });

  it('福州适配器：JSON 首屏可发现，无容器详情显式失败', () => {
    const adapter = new FuzhouEducationAdapter();
    expect(
      adapter.discover({
        url: PAGE1_URL,
        mimeType: 'application/json',
        content: readFixture('search-page1.json'),
        fetchedAt: '2026-11-06T07:40:00.000Z',
      }),
    ).toHaveLength(15);
    expect(() =>
      adapter.locateArticle({
        url: 'https://jyj.fuzhou.gov.cn/zwgk/tzgg/202611/t20261105_5389939.htm',
        mimeType: 'text/html',
        content: '<html><body><p>无容器</p></body></html>',
        fetchedAt: '2026-11-06T07:40:00.000Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('夹具目录不混入临时文件', () => {
    const files = readdirSync(FIXTURE_ROOT).filter((file) =>
      /\.(tmp|log|jsonl)$/.test(file),
    );
    expect(files).toEqual([]);
  });
});
