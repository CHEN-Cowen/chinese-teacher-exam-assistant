import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverJpageRecords,
  isJpageDataUrl,
  jpageDataproxyPages,
  jpagePostRequest,
} from './jpage-list.js';
import { TaianEducationAdapter } from './adapters/taian-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(process.cwd(), '..', 'tests', 'fixtures', 'golden-sources');
const SOURCE = 'taian';

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
      requestBody?: string;
    }[];
  };
}

function sortedEntries(params: URLSearchParams): [string, string][] {
  return [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

describe('S5 N2 Taian jpage：POST 分页与正文附件离线回放', () => {
  const shellManifest = readManifest(SOURCE, 'public-manifest.json');
  const shellFile = shellManifest.files.find(
    (file) => file.name === 'public-shell.html',
  )!;
  const page4File = shellManifest.files.find(
    (file) => file.name === 'public-page4.xml',
  )!;
  const detailManifest = readManifest(SOURCE, 'public-detail-manifest.json');

  it('泰安首屏：内嵌 45 条、总量 227 / 每页 15、后续 13 个 POST 页', () => {
    const shell = readFixture(SOURCE, 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const items = discoverJpageRecords(shellFile.url, shell);
    expect(items).toHaveLength(45);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.taian\.gov\.cn\/art\/\d{4}\/\d{1,2}\/\d{1,2}\/art_45480_\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);

    const pages = jpageDataproxyPages(shellFile.url, shell);
    expect(pages).toHaveLength(13);
    expect(new URL(pages[0]).searchParams.get('startrecord')).toBe('46');
    expect(new URL(pages[0]).searchParams.get('endrecord')).toBe('60');
    expect(new URL(pages[0]).searchParams.get('perpage')).toBe('15');
    expect(new URL(pages[12]).searchParams.get('startrecord')).toBe('226');
    expect(new URL(pages[12]).searchParams.get('endrecord')).toBe('227');
    expect(pages.every((url) => isJpageDataUrl(url))).toBe(true);
  });

  it('POST 请求体从分页 URL 派生，保持官网单次编码的 webname', () => {
    const pages = jpageDataproxyPages(
      shellFile.url,
      readFixture(SOURCE, 'public-shell.html'),
    );
    const request = jpagePostRequest(pages[0]);
    expect(request.method).toBe('POST');
    expect(request.contentType).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(request.body ?? '');
    expect(body.get('col')).toBe('1');
    expect(body.get('sourceContentType')).toBe('1');
    expect(body.get('webname')).toBe('泰安市教育局');
    expect(body.get('columnid')).toBe('45480');
    expect(body.get('unitid')).toBe('146938');
    expect(body.has('startrecord')).toBe(false);
    const expected = new URLSearchParams(page4File.requestBody ?? '');
    expect(sortedEntries(body)).toEqual(sortedEntries(expected));
  });

  it('后续 POST 页：46 条记录与首屏无重叠，且首条为下一页记录', () => {
    const page4 = readFixture(SOURCE, 'public-page4.xml');
    expect(createHash('sha256').update(page4).digest('hex')).toBe(
      page4File.sha256,
    );
    const items = discoverJpageRecords(page4File.url, page4);
    expect(items).toHaveLength(46);
    expect(items[0].title).toContain('寒假安排');
    const first = new Set(
      discoverJpageRecords(
        shellFile.url,
        readFixture(SOURCE, 'public-shell.html'),
      ).map((item) => item.url),
    );
    expect(items.some((item) => first.has(item.url))).toBe(false);
  });

  it('jpage 总页数超预算显式失败，而不是静默截断', () => {
    const shell = readFixture(SOURCE, 'public-shell.html')
      .replace('totalRecord:227', 'totalRecord:6000')
      .replace('perPage:15', 'perPage:15');
    expect(() => jpageDataproxyPages(shellFile.url, shell)).toThrow(
      AdapterParseError,
    );
  });

  it('泰安正文：官方 meta 标题/日期与 ContentStart/ContentEnd 正文', () => {
    const detailFile = detailManifest.files.find(
      (file) => file.name === 'public-detail.html',
    )!;
    const html = readFixture(SOURCE, 'public-detail.html');
    expect(createHash('sha256').update(html).digest('hex')).toBe(
      detailFile.sha256,
    );
    const adapter = new TaianEducationAdapter();
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: html,
      fetchedAt: '2026-11-06T01:50:05.470Z',
    });
    expect(article.title).toContain('公开招聘');
    expect(article.publishedAt).toBe('2026-06-10');
    expect(article.bodyText.length).toBeGreaterThan(20);
    expect(article.attachments).toHaveLength(0);
  });

  it('泰安附件正文：/module/download/downfile.jsp 可被识别', () => {
    const detailFile = detailManifest.files.find(
      (file) => file.name === 'public-detail-attachment.html',
    )!;
    const html = readFixture(SOURCE, 'public-detail-attachment.html');
    expect(createHash('sha256').update(html).digest('hex')).toBe(
      detailFile.sha256,
    );
    const adapter = new TaianEducationAdapter();
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: html,
      fetchedAt: '2026-11-06T01:50:07.274Z',
    });
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain(
      '/module/download/downfile.jsp?',
    );
    expect(article.attachments[0].name).toContain('.pdf');
  });

  it('泰安适配器：首屏/后续页可发现，无 datastore 外壳显式失败', () => {
    const adapter = new TaianEducationAdapter();
    expect(
      adapter.discover({
        url: shellFile.url,
        mimeType: 'text/html',
        content: readFixture(SOURCE, 'public-shell.html'),
        fetchedAt: '2026-11-06T01:50:03.678Z',
      }),
    ).toHaveLength(45);
    expect(
      adapter.pages({
        url: shellFile.url,
        mimeType: 'text/html',
        content: readFixture(SOURCE, 'public-shell.html'),
        fetchedAt: '2026-11-06T01:50:03.678Z',
      }),
    ).toHaveLength(13);
    expect(() =>
      adapter.discover({
        url: shellFile.url,
        mimeType: 'text/html',
        content: '<html><body><ul></ul></body></html>',
        fetchedAt: '2026-11-06T01:50:03.678Z',
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
