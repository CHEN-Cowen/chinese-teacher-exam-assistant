import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WCM5_PAGE_WINDOWS,
  discoverWcm5Records,
  wcm5PageWindow,
  wcm5Pages,
} from './wcm5-list.js';
import { ChangshaEducationAdapter } from './adapters/changsha-education.adapter.js';
import { AdapterParseError } from './official-site-adapter.js';

const FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'changsha-education',
);

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

const LIST_URL = 'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/index.html';
const PAGE2_URL = 'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/index_1.html';
const DETAIL_9393 =
  'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/202611/t20261105_12609393.html';
const DETAIL_8787 =
  'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/202606/t20260616_12407887.html';
const DETAIL_5340 =
  'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/202503/t20250330_11795340.html';
const DETAIL_0817 =
  'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/202602/t20260209_12280817.html';

describe('S5 N3 长沙 WCM createPageHTML5 静态分页族：列表/分页与正文附件离线回放', () => {
  it('列表首屏：15 条、嵌套锚点取 title、详情 URL 与日期规范、含招聘公告', () => {
    const adapter = new ChangshaEducationAdapter();
    const items = adapter.discover({
      url: LIST_URL,
      mimeType: 'text/html',
      content: readFixture('list-page1.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(items).toHaveLength(15);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^http:\/\/jyj\.changsha\.gov\.cn\/zfxxgk\/fdzdgk\/jszp\/\d{6}\/t\d{8}_\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    // 嵌套 <a> 扁平化后外层锚点无标题，解析必须取到内层 title（不能是空串）
    expect(items.every((item) => item.title.length > 0)).toBe(true);
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    expect(items.some((item) => /招聘/.test(item.title))).toBe(true);
    expect(items[0]!.title).toContain('星斗');
    expect(items[0]!.publishedAt).toBe('2026-11-04');
  });

  it('分页：createPageHTML5 声明 8 页，派生 index_1..index_7；未登记 host 超预算显式失败', () => {
    expect(WCM5_PAGE_WINDOWS['jyj.changsha.gov.cn']).toBe(8);
    expect(wcm5PageWindow(LIST_URL)).toBe(8);

    const pages = wcm5Pages(LIST_URL, readFixture('list-page1.html'));
    expect(pages).toHaveLength(7);
    expect(pages[0]).toBe(PAGE2_URL);
    expect(pages.at(-1)).toBe(
      'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/index_7.html',
    );

    // 未登记 host：官方 8 页超预算显式失败
    const otherHost = readFixture('list-page1.html').replaceAll(
      'jyj.changsha.gov.cn',
      'jyj.other.gov.cn',
    );
    expect(() =>
      wcm5Pages(
        'http://jyj.other.gov.cn/zfxxgk/fdzdgk/jszp/index.html',
        otherHost,
        3,
      ),
    ).toThrow(/窗口预算/);

    // 分页页（index_N.html）不重复派生；无脚本声明的页面返回空
    expect(wcm5Pages(PAGE2_URL, readFixture('list-page2.html'))).toEqual([]);
    expect(wcm5Pages(LIST_URL, '<html><body>无分页脚本</body></html>')).toEqual(
      [],
    );
  });

  it('第 2 页与首屏重叠恰好 1 条置顶公告，去重后无重复条目', () => {
    const adapter = new ChangshaEducationAdapter();
    const first = adapter.discover({
      url: LIST_URL,
      mimeType: 'text/html',
      content: readFixture('list-page1.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    const second = adapter.discover({
      url: PAGE2_URL,
      mimeType: 'text/html',
      content: readFixture('list-page2.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(second).toHaveLength(14);
    const overlap = second.filter((item) =>
      first.some((other) => other.url === item.url),
    );
    expect(overlap).toHaveLength(1);
    expect(overlap[0]!.url).toBe(DETAIL_8787);
    const merged = new Set([...first, ...second].map((item) => item.url));
    expect(merged.size).toBe(first.length + second.length - 1);
    // 第 2 页含拟聘用人员名单（招聘结果类公告）
    expect(second.some((item) => /拟聘用/.test(item.title))).toBe(true);
    // 市人社局跨站官方条目（雅礼中学引进竞赛教练）按同源过滤，不计入本来源
    expect(second.some((item) => /雅礼中学/.test(item.title))).toBe(false);
    expect(
      second.every((item) => item.url.startsWith('http://jyj.changsha.gov.cn/')),
    ).toBe(true);
  });

  it('详情：meta 名带空格需 trim、div.content-main 正文与 1 个 pdf 附件名', () => {
    const adapter = new ChangshaEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_9393,
      mimeType: 'text/html',
      content: readFixture('detail-12609393.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('星斗');
    expect(article.publishedAt).toBe('2026-11-04');
    // 该公告正文为短说明句 + 名单附件，正文非空即可（不能按长文阈值断言）
    expect(article.bodyText.length).toBeGreaterThan(0);
    expect(article.bodyText).toContain('星斗');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url).toBe(
      'http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/202611/P020261105372888610180.pdf',
    );
    expect(article.attachments[0]!.name).toContain('入围笔试人员名单');
  });

  it('多附件详情：xlsx 岗位表 + 2 个 docx（第三轮公开招聘公告）', () => {
    const adapter = new ChangshaEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_8787,
      mimeType: 'text/html',
      content: readFixture('detail-12407887.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('第三轮公开招聘');
    expect(article.publishedAt).toBe('2026-06-15');
    expect(article.attachments).toHaveLength(3);
    expect(
      article.attachments.some((a) => a.url.endsWith('.xlsx')),
    ).toBe(true);
    expect(article.attachments.filter((a) => a.url.endsWith('.docx'))).toHaveLength(2);
  });

  it('多附件详情：7 个附件（5 个 pdf 岗位表 + 2 个 docx 承诺书）全部定位', () => {
    const adapter = new ChangshaEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_5340,
      mimeType: 'text/html',
      content: readFixture('detail-11795340.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('第二轮公开招聘');
    expect(article.publishedAt).toBe('2025-03-30');
    expect(article.attachments).toHaveLength(7);
    expect(article.attachments.filter((a) => a.url.endsWith('.pdf'))).toHaveLength(5);
    expect(article.attachments.filter((a) => a.url.endsWith('.docx'))).toHaveLength(2);
    expect(
      article.attachments.every((a) =>
        /^http:\/\/jyj\.changsha\.gov\.cn\/zfxxgk\/fdzdgk\/jszp\/202503\/P\d+\.(pdf|docx)$/.test(
          a.url,
        ),
      ),
    ).toBe(true);
  });

  it('零附件详情回放通过（拟聘用人员名单缓检批）', () => {
    const adapter = new ChangshaEducationAdapter();
    const article = adapter.locateArticle({
      url: DETAIL_0817,
      mimeType: 'text/html',
      content: readFixture('detail-12280817.html'),
      fetchedAt: '2026-11-06T11:00:00.000Z',
    });
    expect(article.title).toContain('拟聘用人员名单');
    expect(article.publishedAt).toBe('2026-02-09');
    expect(article.attachments).toEqual([]);
    expect(article.bodyText.length).toBeGreaterThan(100);
  });

  it('列表/正文容器缺失显式抛错（静默 0 条视为故障）', () => {
    const adapter = new ChangshaEducationAdapter();
    expect(() =>
      adapter.discover({
        url: LIST_URL,
        mimeType: 'text/html',
        content: '<html><body><div class="xxgk-item"></div></body></html>',
        fetchedAt: '2026-11-06T11:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      discoverWcm5Records(
        LIST_URL,
        '<html><body><div class="xxgk-item"><ul></ul></div></body></html>',
      ),
    ).toThrow(/xxgk-item/);
    expect(() =>
      adapter.locateArticle({
        url: DETAIL_9393,
        mimeType: 'text/html',
        content: '<html><body><p>无正文容器</p></body></html>',
        fetchedAt: '2026-11-06T11:00:00.000Z',
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
