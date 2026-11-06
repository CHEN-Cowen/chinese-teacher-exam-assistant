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
import { GuiyangEducationAdapter } from './adapters/guiyang-education.adapter.js';
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

const GY_FIXTURE_ROOT = join(
  process.cwd(),
  '..',
  'tests',
  'fixtures',
  'golden-sources',
  'guiyang-education',
);

function readGyFixture(name: string): string {
  return readFileSync(join(GY_FIXTURE_ROOT, name), 'utf8');
}

const GY_LIST_URL = 'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/';
const GY_PAGE2_URL =
  'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/index_1.html';
const GY_DETAIL_6646 =
  'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/202610/t20261027_91036646.html';
const GY_DETAIL_0572 =
  'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/202609/t20260914_90870572.html';
const GY_DETAIL_6645 =
  'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/202610/t20261027_91036645.html';
const GY_DETAIL_8730 =
  'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/202610/t20261009_90968730.html';

describe('S5 N3 贵阳 WCM createPage 4 参静态分页族：列表/分页与正文附件离线回放', () => {
  it('列表首屏：15 条、a[title] 取标题、详情 URL 与日期规范、含招聘公告', () => {
    const adapter = new GuiyangEducationAdapter();
    const items = adapter.discover({
      url: GY_LIST_URL,
      mimeType: 'text/html',
      content: readGyFixture('list-page1.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(items).toHaveLength(15);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.guiyang\.gov\.cn\/newsite\/zwgk\/zdlyxxgk\/jsgz\/\d{6}\/t\d{8}_\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(items.every((item) => item.title.length > 0)).toBe(true);
    expect(items.every((item) => !/<[a-z]/i.test(item.title))).toBe(true);
    expect(items.some((item) => /招聘/.test(item.title))).toBe(true);
    expect(items[0]!.title).toContain('试教成绩');
    expect(items[0]!.publishedAt).toBe('2026-10-17');
  });

  it('分页：createPage(19,0,"index","html") 声明 19 页，派生 index_1..index_18 全量窗口', () => {
    expect(WCM5_PAGE_WINDOWS['jyj.guiyang.gov.cn']).toBe(19);
    expect(wcm5PageWindow(GY_LIST_URL)).toBe(19);

    const pages = wcm5Pages(GY_LIST_URL, readGyFixture('list-page1.html'));
    expect(pages).toHaveLength(18);
    expect(pages[0]).toBe(GY_PAGE2_URL);
    expect(pages.at(-1)).toBe(
      'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/index_18.html',
    );

    // 分页页（index_N.html）不重复派生
    expect(wcm5Pages(GY_PAGE2_URL, readGyFixture('list-page2.html'))).toEqual(
      [],
    );
  });

  it('第 2 页与首屏 0 重叠，合并去重后 30 条', () => {
    const adapter = new GuiyangEducationAdapter();
    const first = adapter.discover({
      url: GY_LIST_URL,
      mimeType: 'text/html',
      content: readGyFixture('list-page1.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    const second = adapter.discover({
      url: GY_PAGE2_URL,
      mimeType: 'text/html',
      content: readGyFixture('list-page2.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(second).toHaveLength(15);
    const overlap = second.filter((item) =>
      first.some((other) => other.url === item.url),
    );
    expect(overlap).toHaveLength(0);
    const merged = new Set([...first, ...second].map((item) => item.url));
    expect(merged.size).toBe(30);
    // 第 2 页接续首屏末条（2026-08-18）向更早排列，含公费师范生拟聘用公示
    expect(
      second.every((item) => item.publishedAt <= '2026-08-18'),
    ).toBe(true);
    expect(second.some((item) => /拟聘用/.test(item.title))).toBe(true);
  });

  it('详情：meta 标准名无空格、PubDate 带时分取日期、div.TRS_UEDITOR 正文与 1 个 pdf 附件', () => {
    const adapter = new GuiyangEducationAdapter();
    const article = adapter.locateArticle({
      url: GY_DETAIL_6646,
      mimeType: 'text/html',
      content: readGyFixture('detail-91036646.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(article.title).toContain('试教成绩');
    expect(article.publishedAt).toBe('2026-10-17');
    expect(article.bodyText).toContain('试教成绩');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0]!.url).toBe(
      'https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/202610/P020261017776820758504.pdf',
    );
    expect(article.attachments[0]!.name).toContain('试教成绩一览表');
  });

  it('多附件详情：4 个附件（xlsx 岗位表 + xls + docx + xlsx，公费师范生招聘公告）', () => {
    const adapter = new GuiyangEducationAdapter();
    const article = adapter.locateArticle({
      url: GY_DETAIL_0572,
      mimeType: 'text/html',
      content: readGyFixture('detail-90870572.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(article.title).toContain('公费教育师范生招聘公告');
    expect(article.publishedAt).toBe('2026-09-05');
    expect(article.attachments).toHaveLength(4);
    expect(article.attachments.filter((a) => a.url.endsWith('.xlsx'))).toHaveLength(2);
    expect(article.attachments.some((a) => a.url.endsWith('.xls'))).toBe(true);
    expect(article.attachments.some((a) => a.url.endsWith('.docx'))).toBe(true);
    expect(
      article.attachments.every((a) =>
        /^https:\/\/jyj\.guiyang\.gov\.cn\/newsite\/zwgk\/zdlyxxgk\/jsgz\/202609\/P\d+\.(xlsx?|docx)$/.test(
          a.url,
        ),
      ),
    ).toBe(true);
  });

  it('2 附件详情：xls 面试名单 + doc 面试须知（面试公告）', () => {
    const adapter = new GuiyangEducationAdapter();
    const article = adapter.locateArticle({
      url: GY_DETAIL_6645,
      mimeType: 'text/html',
      content: readGyFixture('detail-91036645.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(article.title).toContain('面试公告');
    expect(article.publishedAt).toBe('2026-10-13');
    expect(article.attachments).toHaveLength(2);
    expect(article.attachments.some((a) => a.url.endsWith('.xls'))).toBe(true);
    expect(article.attachments.some((a) => a.url.endsWith('.doc'))).toBe(true);
  });

  it('零附件详情回放通过（教师公开招聘拟聘用人员公示，名单在正文表格）', () => {
    const adapter = new GuiyangEducationAdapter();
    const article = adapter.locateArticle({
      url: GY_DETAIL_8730,
      mimeType: 'text/html',
      content: readGyFixture('detail-90968730.html'),
      fetchedAt: '2026-11-06T14:40:00.000Z',
    });
    expect(article.title).toContain('拟聘用人员公示');
    expect(article.publishedAt).toBe('2026-09-22');
    expect(article.attachments).toEqual([]);
    expect(article.bodyText.length).toBeGreaterThan(50);
  });

  it('列表/正文容器缺失显式抛错（静默 0 条视为故障）', () => {
    const adapter = new GuiyangEducationAdapter();
    expect(() =>
      adapter.discover({
        url: GY_LIST_URL,
        mimeType: 'text/html',
        content: '<html><body><ul class="right-cont_list"></ul></body></html>',
        fetchedAt: '2026-11-06T14:40:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      adapter.locateArticle({
        url: GY_DETAIL_6646,
        mimeType: 'text/html',
        content: '<html><body><p>无正文容器</p></body></html>',
        fetchedAt: '2026-11-06T14:40:00.000Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('贵阳夹具目录不混入临时文件', () => {
    const files = readdirSync(GY_FIXTURE_ROOT).filter((file) =>
      /\.(tmp|log|jsonl)$/.test(file),
    );
    expect(files).toEqual([]);
  });
});
