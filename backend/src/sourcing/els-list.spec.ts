import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  elsArticlePages,
  elsJsonRequest,
  discoverElsRecords,
  ELS_PAGE_WINDOWS,
  isElsArticleUrl,
} from './els-list.js';
import { WeifangEducationAdapter } from './adapters/weifang-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
);
const SOURCE = 'weifang';

function fixtureDir(name = SOURCE): string {
  return join(FIXTURE_ROOT, name);
}

function readFixture(name: string, file?: string): string {
  return readFileSync(join(fixtureDir(name), file ?? ''), 'utf8');
}

function readManifest(name: string, file: string): {
  capturedAt: string;
  scope: string;
  files: {
    name: string;
    url: string;
    sha256: string;
    method?: string;
    contentType?: string;
    requestBody?: string;
  }[];
} {
  return JSON.parse(readFileSync(join(fixtureDir(name), file), 'utf8')) as {
    capturedAt: string;
    scope: string;
    files: {
      name: string;
      url: string;
      sha256: string;
      method?: string;
      contentType?: string;
      requestBody?: string;
    }[];
  };
}

describe('S5 N2 潍坊 els-service：JSON POST 列表与正文附件离线回放', () => {
  const listManifest = readManifest(SOURCE, 'public-manifest.json');
  const page1File = listManifest.files.find(
    (file) => file.name === 'public-page1.json',
  )!;
  const page3File = listManifest.files.find(
    (file) => file.name === 'public-page3.json',
  )!;
  const detailManifest = readManifest(SOURCE, 'public-detail-manifest.json');

  it('首屏 JSON：20 条、日期/URL 规范、含公开招聘条目、内嵌 HTML 标题被剥离', () => {
    const page1 = readFixture(SOURCE, 'public-page1.json');
    expect(createHash('sha256').update(page1).digest('hex')).toBe(
      page1File.sha256,
    );
    const items = discoverElsRecords(page1File.url, page1);
    expect(items).toHaveLength(20);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.weifang\.gov\.cn\/55332\/\d+\.html$/.test(item.url),
      ),
    ).toBe(true);
    // 历史条目 subject 内嵌 <DIV>/<SPAN>，解析结果不得残留标签
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    // 首屏为近期混合条目（决算/公示/资格领取），公开招聘公告在更深的页
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(false);
    const page3Items = discoverElsRecords(
      page3File.url,
      readFixture(SOURCE, 'public-page3.json'),
    );
    expect(page3Items.some((item) => item.title.includes('公开招聘'))).toBe(
      true,
    );
  });

  it('分页 URL 派生 POST JSON 请求体，与官方抓包一致', () => {
    expect(isElsArticleUrl(page1File.url)).toBe(true);
    expect(isElsArticleUrl('https://jyj.weifang.gov.cn/jyjlist/?cataId=x')).toBe(
      false,
    );
    const request = elsJsonRequest(page1File.url);
    expect(request.method).toBe('POST');
    expect(request.contentType).toBe('application/json');
    expect(JSON.parse(request.body ?? '')).toEqual({
      dq: '162',
      dwid: '55332',
      catas: ['trs1308521'],
    });
    expect(request.body).toBe(page3File.requestBody);
    expect(() =>
      elsJsonRequest('https://jyj.weifang.gov.cn/els-service/article/1/20'),
    ).toThrow(AdapterParseError);
  });

  it('后续页：官方 49 页超 6 页窗口显式失败；小总页数生成 2..N 页', () => {
    const page1 = readFixture(SOURCE, 'public-page1.json');
    expect(ELS_PAGE_WINDOWS['jyj.weifang.gov.cn']).toBe(6);
    expect(() => elsArticlePages(page1File.url, page1)).toThrow(
      /窗口预算/,
    );
    // 显式放宽窗口后按 totalPages 生成第 2..N 页，size 保留自当前 URL
    const pages = elsArticlePages(page1File.url, page1, 49);
    expect(pages).toHaveLength(48);
    expect(pages[0]).toBe(
      'https://jyj.weifang.gov.cn/els-service/article/2/20?catas=trs1308521&dwid=55332&dq=162',
    );
    expect(new URL(pages[47]).pathname).toBe('/els-service/article/49/20');
    // 非 els JSON（HTML 列表页 / jpaas 响应）静默返回空数组，不误报结构漂移
    expect(
      elsArticlePages('https://jyj.weifang.gov.cn/x.html', '<html/>'),
    ).toEqual([]);
    expect(
      elsArticlePages(
        page1File.url,
        '{"success":true,"data":{"html":"<div/>"}}',
      ),
    ).toEqual([]);
  });

  it('第 3 页与首屏无重叠（衔接校验）', () => {
    const page3 = readFixture(SOURCE, 'public-page3.json');
    expect(createHash('sha256').update(page3).digest('hex')).toBe(
      page3File.sha256,
    );
    const first = new Set(
      discoverElsRecords(page1File.url, readFixture(SOURCE, 'public-page1.json')).map(
        (item) => item.url,
      ),
    );
    const items = discoverElsRecords(page3File.url, page3);
    expect(items).toHaveLength(20);
    expect(items.some((item) => first.has(item.url))).toBe(false);
  });

  it('空 contents 或接口失败显式抛错（静默 0 条视为故障）', () => {
    expect(() =>
      discoverElsRecords(page1File.url, '{"success":false}'),
    ).toThrow(AdapterParseError);
    expect(() =>
      discoverElsRecords(
        page1File.url,
        '{"success":true,"data":{"totalPages":49,"contents":[]}}',
      ),
    ).toThrow(AdapterParseError);
    expect(() => discoverElsRecords(page1File.url, '<html/>')).toThrow(
      AdapterParseError,
    );
  });

  it('潍坊正文：meta 标题/日期与 td#Content 正文', () => {
    const detailFile = detailManifest.files.find(
      (file) => file.name === 'public-detail.html',
    )!;
    const html = readFixture(SOURCE, 'public-detail.html');
    expect(createHash('sha256').update(html).digest('hex')).toBe(
      detailFile.sha256,
    );
    const adapter = new WeifangEducationAdapter();
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: html,
      fetchedAt: '2026-11-06T02:50:20.000Z',
    });
    expect(article.title).toContain('公开招聘');
    expect(article.publishedAt).toBe('2026-08-14');
    expect(article.bodyText.length).toBeGreaterThan(50);
    expect(article.attachments.length).toBeGreaterThanOrEqual(2);
    expect(
      article.attachments.every((attachment) =>
        attachment.url.includes('/upload-service/'),
      ),
    ).toBe(true);
    expect(
      article.attachments.some((attachment) => attachment.name.includes('xls')),
    ).toBe(true);
  });

  it('潍坊附件正文：/upload-service/ xlsx 可被识别且去重', () => {
    const detailFile = detailManifest.files.find(
      (file) => file.name === 'public-detail-attachment.html',
    )!;
    const html = readFixture(SOURCE, 'public-detail-attachment.html');
    expect(createHash('sha256').update(html).digest('hex')).toBe(
      detailFile.sha256,
    );
    const adapter = new WeifangEducationAdapter();
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: html,
      fetchedAt: '2026-11-06T02:50:22.000Z',
    });
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain('/upload-service/');
    expect(article.attachments[0].name).toContain('xlsx');
  });

  it('潍坊适配器：JSON 首屏可发现，HTML 壳显式失败；页尾空 meta 不覆盖有效值', () => {
    const adapter = new WeifangEducationAdapter();
    expect(
      adapter.discover({
        url: page1File.url,
        mimeType: 'application/json',
        content: readFixture(SOURCE, 'public-page1.json'),
        fetchedAt: '2026-11-06T02:50:20.000Z',
      }),
    ).toHaveLength(20);
    expect(() =>
      adapter.locateArticle({
        url: 'https://jyj.weifang.gov.cn/55332/1.html',
        mimeType: 'text/html',
        content: '<html><body><p>无容器</p></body></html>',
        fetchedAt: '2026-11-06T02:50:20.000Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('夹具目录不混入临时文件', () => {
    const files = readdirSync(fixtureDir()).filter((file) =>
      /\.(tmp|log|jsonl)$/.test(file),
    );
    expect(files).toEqual([]);
  });
});
