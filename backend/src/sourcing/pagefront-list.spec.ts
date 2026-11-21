import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPagefrontUrl,
  PAGEFRONT_PAGE_WINDOWS,
  discoverPagefrontRecords,
  pagefrontPages,
  pagefrontPageWindow,
  pagefrontRequest,
} from './pagefront-list.js';
import { ShijiazhuangEducationAdapter } from './adapters/shijiazhuang-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'shijiazhuang-education',
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

const LIST_URL = 'http://sjzjyj.sjz.gov.cn/a/zwgk/tzgg/index.html';
const PAGE2_URL =
  'http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp?parseId=745b8ad5a0b647b8859292efe60a4378&categoryId=a67a560e4cc8455999902184be54edb5&keyword=&pageNo=2';
const DETAIL_1472 = 'http://sjzjyj.sjz.gov.cn/a/2026/10/16/1792137061472.html';
const DETAIL_1163 = 'http://sjzjyj.sjz.gov.cn/a/2026/10/09/1791533151163.html';
const DETAIL_9011 = 'http://sjzjyj.sjz.gov.cn/a/2026/08/14/1786673899011.html';

describe('S5 N3 石家庄 PageFront 表单 POST 分页族：列表/分页与正文附件离线回放', () => {
  it('列表首屏：20 条、li>div.ul_zi 结构、详情 URL 规范、含教师招募公告', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    const items = adapter.discover({
      url: LIST_URL,
      mimeType: 'text/html',
      content: readFixture('tzgg-index.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(items).toHaveLength(20);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^http:\/\/sjzjyj\.sjz\.gov\.cn\/a\/\d{4}\/\d{2}\/\d{2}\/\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    // 通知公告为混合栏目：首屏含公开招募银龄讲学教师公告
    expect(
      items.some((item) => /招募.*教师|招聘/.test(item.title)),
    ).toBe(true);
    expect(items[0]!.title).toContain('校徽样式');
    expect(items[0]!.publishedAt).toBe('2026-10-16');
  });

  it('分页：pageForm 末页 page(6)，按窗口封顶到 6 页；未登记 host 超预算显式失败', () => {
    expect(isPagefrontUrl(PAGE2_URL)).toBe(true);
    expect(isPagefrontUrl(LIST_URL)).toBe(false);
    expect(PAGEFRONT_PAGE_WINDOWS['sjzjyj.sjz.gov.cn']).toBe(6);
    expect(pagefrontPageWindow(LIST_URL)).toBe(6);

    const pages = pagefrontPages(LIST_URL, readFixture('tzgg-index.html'));
    expect(pages).toHaveLength(5);
    expect(pages[0]).toBe(PAGE2_URL);
    expect(new URL(pages.at(-1)!).searchParams.get('pageNo')).toBe('6');
    // 派生 URL 携带全部表单字段
    const derived = new URL(pages[0]!);
    expect(derived.searchParams.get('parseId')).toBe(
      '745b8ad5a0b647b8859292efe60a4378',
    );
    expect(derived.searchParams.get('categoryId')).toBe(
      'a67a560e4cc8455999902184be54edb5',
    );

    // 未登记 host：官方末页超预算显式失败
    const otherHostContent = readFixture('tzgg-index.html').replaceAll(
      'sjzjyj.sjz.gov.cn',
      'sjzjyj.other.gov.cn',
    );
    expect(() =>
      pagefrontPages(
        'http://sjzjyj.other.gov.cn/a/zwgk/tzgg/index.html',
        otherHostContent,
        3,
      ),
    ).toThrow(/窗口预算/);

    // 分页响应页 / 非本族页面 / 无页码锚点：均返回空数组，不误报
    expect(pagefrontPages(PAGE2_URL, readFixture('pagefront-page2.html'))).toEqual(
      [],
    );
    expect(pagefrontPages(LIST_URL, '<html><body>无分页</body></html>')).toEqual(
      [],
    );
  });

  it('分页请求体：由 URL query 确定性派生 POST 表单（字段顺序同官网）', () => {
    const request = pagefrontRequest(PAGE2_URL);
    expect(request.method).toBe('POST');
    expect(request.contentType).toBe('application/x-www-form-urlencoded');
    expect(request.body).toBe(
      'parseId=745b8ad5a0b647b8859292efe60a4378&categoryId=a67a560e4cc8455999902184be54edb5&keyword=&pageNo=2',
    );
    expect(() =>
      pagefrontRequest('http://sjzjyj.sjz.gov.cn/dynamic/PageFront.jsp'),
    ).toThrow(/缺少 parseId\/categoryId\/pageNo/);
  });

  it('第 2 页 POST 响应与首屏无重叠，站外微信转载条目按详情路径过滤', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    const first = new Set(
      adapter
        .discover({
          url: LIST_URL,
          mimeType: 'text/html',
          content: readFixture('tzgg-index.html'),
          fetchedAt: '2026-11-06T10:20:00.000Z',
        })
        .map((item) => item.url),
    );
    const items = adapter.discover({
      url: PAGE2_URL,
      mimeType: 'text/html',
      content: readFixture('pagefront-page2.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    // 第 2 页 20 行中 2 条为微信公众号站外转载（无站内详情地址），过滤后 18 条
    expect(items).toHaveLength(18);
    expect(items.some((item) => first.has(item.url))).toBe(false);
    expect(items.every((item) => item.url.startsWith('http://sjzjyj.sjz.gov.cn/'))).toBe(
      true,
    );
    expect(items[0]!.publishedAt <= '2026-07-18').toBe(true);
  });

  it('详情：meta 标题/日期、div.content_fenye2 正文与 3 个 zip 附件名', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_1472,
      mimeType: 'text/html',
      content: readFixture('detail-1792137061472.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(article.title).toBe(
      '石家庄市教育局关于公布石家庄市中小学校徽样式的公告',
    );
    expect(article.publishedAt).toBe('2026-10-16');
    expect(article.bodyText).toContain('校徽');
    expect(article.attachments).toHaveLength(3);
    expect(article.attachments[0]!.url).toBe(
      'http://sjzjyj.sjz.gov.cn/resources/43/71035726844514257.zip',
    );
    expect(article.attachments[0]!.name).toContain('校徽样式一');
  });

  it('招聘相关详情：ArticleTitle 内嵌 <br> 清洗、2 个 docx 附件（nbsp 前缀剥离）', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_1163,
      mimeType: 'text/html',
      content: readFixture('detail-1791533151163.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(article.title).toBe(
      '石家庄市教育局关于公开招募2026—2027学年 银龄讲学计划讲学教师的公告',
    );
    expect(article.title).not.toMatch(/<br|\r|\n/);
    expect(article.publishedAt).toBe('2026-10-09');
    expect(article.attachments).toHaveLength(2);
    expect(article.attachments[0]!.url).toBe(
      'http://sjzjyj.sjz.gov.cn/resources/43/70433317506850120.docx',
    );
    expect(article.attachments[0]!.name).toContain('需求表');
    expect(article.attachments[1]!.name).toContain('报名表');
    expect(article.attachments[1]!.name.startsWith('银龄讲学计划')).toBe(true);
  });

  it('零附件详情回放通过（励耕计划拟资助名单公示）', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_9011,
      mimeType: 'text/html',
      content: readFixture('detail-1786673899011.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(article.title).toContain('励耕计划');
    expect(article.publishedAt).toBe('2026-08-14');
    expect(article.attachments).toEqual([]);
  });

  it('正文容器/列表结构缺失显式抛错（静默 0 条视为故障）', () => {
    const adapter = new ShijiazhuangEducationAdapter();
    expect(() =>
      adapter.locateArticle({
        url: DETAIL_1472,
        mimeType: 'text/html',
        content: '<html><body><p>无容器</p></body></html>',
        fetchedAt: '2026-11-06T10:20:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      adapter.discover({
        url: LIST_URL,
        mimeType: 'text/html',
        content: '<html><body><ul></ul></body></html>',
        fetchedAt: '2026-11-06T10:20:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      discoverPagefrontRecords(LIST_URL, '<html><body></body></html>'),
    ).toThrow(/div\.ul_zi/);
  });

  it('夹具目录不混入临时文件', () => {
    const files = readdirSync(FIXTURE_ROOT).filter((file) =>
      /\.(tmp|log|jsonl)$/.test(file),
    );
    expect(files).toEqual([]);
  });
});
