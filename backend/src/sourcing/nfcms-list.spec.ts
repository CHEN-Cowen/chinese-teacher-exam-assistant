import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isNfcmsIndexUrl,
  NFCMS_PAGE_WINDOWS,
  nfcmsIndexPages,
  nfcmsPageWindow,
} from './nfcms-list.js';
import { staticListPages } from './public-column.js';
import { GuangzhouEducationAdapter } from './adapters/guangzhou-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'guangzhou-education',
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

const LIST_URL = 'https://jyj.gz.gov.cn/yw/wsgs/index.html';
const PAGE2_URL = 'https://jyj.gz.gov.cn/yw/wsgs/index_2.html';
const DETAIL_11019946 =
  'https://jyj.gz.gov.cn/yw/wsgs/content/post_11019946.html';
const DETAIL_11080595 =
  'https://jyj.gz.gov.cn/yw/wsgs/content/post_11080595.html';

describe('S5 N3 广州 NFCMS 集约化平台：静态锚点列表/分页与正文附件离线回放', () => {
  it('列表首屏：20 条、方括号日期剥离、详情 URL 规范', () => {
    const adapter = new GuangzhouEducationAdapter();
    const items = adapter.discover({
      url: LIST_URL,
      mimeType: 'text/html',
      content: readFixture('wsgs-index.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(items).toHaveLength(20);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.gz\.gov\.cn\/yw\/wsgs\/content\/post_\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    // 网上公示为高密度招聘栏目：首屏含公开招聘教师拟聘用公示
    expect(items.filter((item) => /公开招聘|拟聘用/.test(item.title)).length)
      .toBeGreaterThanOrEqual(4);
  });

  it('分页：a.last 指向末页 20，按窗口封顶到 6 页；未登记 host 超预算显式失败', () => {
    expect(isNfcmsIndexUrl(LIST_URL)).toBe(true);
    expect(isNfcmsIndexUrl(PAGE2_URL)).toBe(false);
    expect(NFCMS_PAGE_WINDOWS['jyj.gz.gov.cn']).toBe(6);
    expect(nfcmsPageWindow(LIST_URL)).toBe(6);

    const pages = nfcmsIndexPages(LIST_URL, readFixture('wsgs-index.html'));
    expect(pages).toHaveLength(5);
    expect(pages[0]).toBe(PAGE2_URL);
    expect(new URL(pages.at(-1)!).pathname).toBe('/yw/wsgs/index_6.html');

    // 未登记 host：锚点同源（改写 host）时才参与派生，官方末页超预算显式失败
    const otherHostUrl = 'https://jyj.other.gov.cn/yw/wsgs/index.html';
    const otherHostContent = readFixture('wsgs-index.html').replaceAll(
      'jyj.gz.gov.cn',
      'jyj.other.gov.cn',
    );
    expect(() => nfcmsIndexPages(otherHostUrl, otherHostContent, 3)).toThrow(
      /窗口预算/,
    );

    // 已是后续页 / 非 index.html 形态 / 无 index_N 锚点：均返回空数组，不误报
    expect(nfcmsIndexPages(PAGE2_URL, readFixture('wsgs-index-2.html'))).toEqual(
      [],
    );
    expect(nfcmsIndexPages(LIST_URL, '<html><body>无分页</body></html>')).toEqual(
      [],
    );
    expect(
      nfcmsIndexPages(
        'https://jyj.gz.gov.cn/yw/tzgg/notice.html',
        readFixture('wsgs-index.html'),
      ),
    ).toEqual([]);
  });

  it('回归：页内 createPageHTML 声明已被注释失效，锚点分页才是真实路径', () => {
    // 页面留下 `<!-- <script>…createPageHTML('page_div',3,1,'list','shtml',60)… -->`
    // 的注释，staticListPages 因此返回空；若只依赖它，广州将永远只抓首屏 20 条。
    expect(staticListPages(LIST_URL, readFixture('wsgs-index.html'))).toEqual([]);
    const anchored = nfcmsIndexPages(LIST_URL, readFixture('wsgs-index.html'));
    expect(anchored).toContain(PAGE2_URL);
    expect(anchored.some((url) => url.includes('list_'))).toBe(false);
  });

  it('第 2 页与首屏无重叠，首条为公开招聘教师公示', () => {
    const adapter = new GuangzhouEducationAdapter();
    const first = new Set(
      adapter
        .discover({
          url: LIST_URL,
          mimeType: 'text/html',
          content: readFixture('wsgs-index.html'),
          fetchedAt: '2026-11-06T10:20:00.000Z',
        })
        .map((item) => item.url),
    );
    const items = adapter.discover({
      url: PAGE2_URL,
      mimeType: 'text/html',
      content: readFixture('wsgs-index-2.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(items).toHaveLength(20);
    expect(items.some((item) => first.has(item.url))).toBe(false);
    expect(items[0]!.title).toContain('公开招聘教师');
    expect(items[0]!.publishedAt).toBe('2026-09-24');
  });

  it('详情：meta 标题/日期、div#zoomcon 正文与 xlsx 附件名', () => {
    const adapter = new GuangzhouEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_11019946,
      mimeType: 'text/html',
      content: readFixture('detail-post_11019946.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(article.title).toBe(
      '广州市教育局直属事业单位广州市第六中学2026年第一次公开招聘教师第三批拟聘用人员公示',
    );
    expect(article.publishedAt).toBe('2026-09-24');
    expect(article.bodyText).toContain('拟聘用');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url).toBe(
      'https://jyj.gz.gov.cn/attachment/8/8079/8079185/11019946.xlsx',
    );
    expect(article.attachments[0]!.name).toContain('拟聘用人员名单');
  });

  it('第二条详情同样回放通过（事业单位引进急需人才）', () => {
    const adapter = new GuangzhouEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_11080595,
      mimeType: 'text/html',
      content: readFixture('detail-post_11080595.html'),
      fetchedAt: '2026-11-06T10:20:00.000Z',
    });
    expect(article.title).toContain('引进急需人才');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url.endsWith('.xlsx')).toBe(true);
  });

  it('正文容器缺失显式抛错（静默 0 条视为故障）', () => {
    const adapter = new GuangzhouEducationAdapter();
    expect(() =>
      adapter.locateArticle({
        url: DETAIL_11019946,
        mimeType: 'text/html',
        content: '<html><body><p>无容器</p></body></html>',
        fetchedAt: '2026-11-06T10:20:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(
      () =>
        adapter.discover({
          url: LIST_URL,
          mimeType: 'text/html',
          content: '<html><body><div class="news_list"><ul></ul></div></body></html>',
          fetchedAt: '2026-11-06T10:20:00.000Z',
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
