import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WHSNAV_PAGE_WINDOWS,
  discoverWhsnavRecords,
  whsnavPages,
  whsnavPageWindow,
} from './whsnav-list.js';
import { WuhanEducationAdapter } from './adapters/wuhan-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'wuhan-education',
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

const LIST_URL = 'https://jyj.wuhan.gov.cn/zwdt/tsgg/';
const PAGE2_URL = 'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_1.shtml';
const DETAIL_4543 =
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/202611/t20261105_2874543.shtml';
const DETAIL_2600 =
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/202610/t20261016_2862600.shtml';
const DETAIL_5618 =
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/202607/t20260701_2815618.shtml';
const DETAIL_0654 =
  'https://jyj.wuhan.gov.cn/zwdt/tsgg/202610/t20261013_2860654.shtml';

describe('S5 N3 武汉 navbox 静态锚点分页族：列表/分页与正文附件离线回放', () => {
  it('列表首屏：10 条、li>a.item-li-a 结构、详情 URL 规范、含招聘拟聘用公示', () => {
    const adapter = new WuhanEducationAdapter();
    const items = adapter.discover({
      url: LIST_URL,
      mimeType: 'text/html',
      content: readFixture('list-page1.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(items).toHaveLength(10);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.wuhan\.gov\.cn\/zwdt\/tsgg\/\d{6}\/t\d{8}_\d+\.shtml$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    // 通知公告为混合栏目：首屏含直属单位公开招聘拟聘用人员公示
    expect(items.some((item) => /招聘|聘用/.test(item.title))).toBe(true);
    expect(items[0]!.title).toBe(
      '2026年度武汉市教育局直属单位事业单位公开招聘拟聘用人员公示（二）',
    );
    expect(items[0]!.publishedAt).toBe('2026-11-05');
  });

  it('分页：pagenav_tail 尾页 index_49（50 页），按窗口封顶派生 index_1..index_5；未登记 host 超预算显式失败', () => {
    expect(WHSNAV_PAGE_WINDOWS['jyj.wuhan.gov.cn']).toBe(6);
    expect(whsnavPageWindow(LIST_URL)).toBe(6);

    const pages = whsnavPages(LIST_URL, readFixture('list-page1.html'));
    expect(pages).toHaveLength(5);
    expect(pages[0]).toBe(PAGE2_URL);
    expect(pages.at(-1)).toBe(
      'https://jyj.wuhan.gov.cn/zwdt/tsgg/index_5.shtml',
    );

    // 未登记 host：官方 50 页超预算显式失败
    const otherHostContent = readFixture('list-page1.html').replaceAll(
      'jyj.wuhan.gov.cn',
      'jyj.other.gov.cn',
    );
    expect(() =>
      whsnavPages('https://jyj.other.gov.cn/zwdt/tsgg/', otherHostContent, 3),
    ).toThrow(/窗口预算/);

    // 分页页（index_N.shtml）/ 非本族页面：均返回空数组，不误报
    expect(whsnavPages(PAGE2_URL, readFixture('list-page2.html'))).toEqual([]);
    expect(whsnavPages(LIST_URL, '<html><body>无分页</body></html>')).toEqual(
      [],
    );
  });

  it('第 2 页与首屏无重叠，10 条详情 URL 同形态', () => {
    const adapter = new WuhanEducationAdapter();
    const first = new Set(
      adapter
        .discover({
          url: LIST_URL,
          mimeType: 'text/html',
          content: readFixture('list-page1.html'),
          fetchedAt: '2026-11-06T11:00:00.000Z',
        })
        .map((item) => item.url),
    );
    const items = adapter.discover({
      url: PAGE2_URL,
      mimeType: 'text/html',
      content: readFixture('list-page2.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(items).toHaveLength(10);
    expect(items.some((item) => first.has(item.url))).toBe(false);
    expect(
      items.every((item) => item.url.startsWith('https://jyj.wuhan.gov.cn/')),
    ).toBe(true);
    // 第 2 页含直属单位招聘面试资格复审公告（招聘相关）
    expect(items.some((item) => /招聘/.test(item.title))).toBe(true);
    expect(items[0]!.publishedAt <= '2026-08-20').toBe(true);
  });

  it('详情：meta 标题/日期、div#article-box 正文与 1 个 pdf 附件名', () => {
    const adapter = new WuhanEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_4543,
      mimeType: 'text/html',
      content: readFixture('detail-2874543.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toBe(
      '2026年度武汉市教育局直属单位事业单位公开招聘拟聘用人员公示（二）',
    );
    expect(article.publishedAt).toBe('2026-11-05');
    expect(article.bodyText).toContain('拟聘用人员名单');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url).toBe(
      'https://jyj.wuhan.gov.cn/zwdt/tsgg/202611/P020261105452294136320.pdf',
    );
    expect(article.attachments[0]!.name).toContain('拟聘用人员公示表（二）');
  });

  it('多附件详情：4 个 pdf 附件全部定位（资格认定公告）', () => {
    const adapter = new WuhanEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_2600,
      mimeType: 'text/html',
      content: readFixture('detail-2862600.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('教师资格认定');
    expect(article.publishedAt).toBe('2026-10-16');
    expect(article.attachments).toHaveLength(4);
    expect(
      article.attachments.every((a) =>
        /^https:\/\/jyj\.wuhan\.gov\.cn\/zwdt\/tsgg\/202610\/P\d+\.pdf$/.test(
          a.url,
        ),
      ),
    ).toBe(true);
  });

  it('招聘相关旧条目详情回放（公费师范生专项招聘面试成绩公告）', () => {
    const adapter = new WuhanEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_5618,
      mimeType: 'text/html',
      content: readFixture('detail-2815618.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('公费师范生专项招聘面试成绩');
    expect(article.publishedAt).toBe('2026-07-01');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url).toBe(
      'https://jyj.wuhan.gov.cn/zwdt/tsgg/202607/P020260701586633434322.pdf',
    );
  });

  it('零附件详情回放通过（教师资格定期注册试点工作通知）', () => {
    const adapter = new WuhanEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_0654,
      mimeType: 'text/html',
      content: readFixture('detail-2860654.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('定期注册');
    expect(article.publishedAt).toBe('2026-10-13');
    expect(article.attachments).toEqual([]);
  });

  it('正文容器/列表结构缺失显式抛错（静默 0 条视为故障）', () => {
    const adapter = new WuhanEducationAdapter();
    expect(() =>
      adapter.locateArticle({
        url: DETAIL_4543,
        mimeType: 'text/html',
        content: '<html><body><p>无容器</p></body></html>',
        fetchedAt: '2026-11-06T11:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      adapter.discover({
        url: LIST_URL,
        mimeType: 'text/html',
        content: '<html><body><ul></ul></body></html>',
        fetchedAt: '2026-11-06T11:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      discoverWhsnavRecords(LIST_URL, '<html><body></body></html>'),
    ).toThrow(/item-li-a/);
  });

  it('夹具目录不混入临时文件', () => {
    const files = readdirSync(FIXTURE_ROOT).filter((file) =>
      /\.(tmp|log|jsonl)$/.test(file),
    );
    expect(files).toEqual([]);
  });
});
