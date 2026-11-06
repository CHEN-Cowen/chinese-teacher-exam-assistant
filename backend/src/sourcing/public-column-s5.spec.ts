import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AdapterParseError } from './official-site-adapter.js';
import {
  columnTablePages,
  discoverColumnTable,
  discoverGovInfoList,
  discoverPublicColumn,
  discoverServerRenderedList,
  discoverStaticAnchorList,
  discoverStaticList,
  govInfoListPages,
  jsPaginationPages,
  locateOfficialArticle,
  publicColumnPages,
  publicColumnRequest,
  serverRenderedListPages,
  staticListPages,
} from './public-column.js';
import { ShaoxingEducationAdapter } from './adapters/shaoxing-education.adapter.js';
import { JiaxingEducationAdapter } from './adapters/jiaxing-education.adapter.js';
import { SuzhouEducationAdapter } from './adapters/suzhou-education.adapter.js';
import { ChangzhouEducationAdapter } from './adapters/changzhou-education.adapter.js';
import { BengbuEducationAdapter } from './adapters/bengbu-education.adapter.js';
import { XiaoshanEducationAdapter } from './adapters/xiaoshan-education.adapter.js';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { LishuiEducationAdapter } from './adapters/lishui-education.adapter.js';
import { HuzhouEducationAdapter } from './adapters/huzhou-education.adapter.js';
import { TaizhouEducationAdapter } from './adapters/taizhou-education.adapter.js';
import { BozhouEducationAdapter } from './adapters/bozhou-education.adapter.js';
import { FuyangEducationAdapter } from './adapters/fuyang-education.adapter.js';
import { JinanEducationAdapter } from './adapters/jinan-education.adapter.js';
import { YantaiEducationAdapter } from './adapters/yantai-education.adapter.js';
import { NanchangEducationAdapter } from './adapters/nanchang-education.adapter.js';
import { TaiyuanEducationAdapter } from './adapters/taiyuan-education.adapter.js';

function fixtureDir(key: string): string {
  return path.resolve(process.cwd(), '../tests/fixtures/golden-sources', key);
}

function readFixture(key: string, name: string): string {
  return readFileSync(path.join(fixtureDir(key), name), 'utf8');
}

function readManifest(
  key: string,
  name: string,
): {
  files: { name: string; url: string; sha256: string }[];
  stableMonitoringVerified?: boolean;
} {
  return JSON.parse(readFixture(key, name));
}

describe('S5 新增官方来源真实样本回放', () => {
  it.each([['shaoxing', '绍兴市教育局教师招聘', SHAOXING_LIST]] as const)(
    '%s 官方公开接口快照与列表解析一致',
    (key, label) => {
      const manifest = readManifest(key, 'public-list-manifest.json') as {
        files: { name: string; url: string; sha256: string }[];
      };
      const bytes = readFileSync(
        path.join(fixtureDir(key), manifest.files[0].name),
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        manifest.files[0].sha256,
      );
      const items = discoverPublicColumn(
        manifest.files[0].url,
        bytes.toString('utf8'),
        'shaoxing',
      );
      expect(items.length).toBeGreaterThan(3);
      expect(items.every((item) => item.title.length > 4)).toBe(true);
      expect(
        items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
      ).toBe(true);
      expect(items.some((item) => item.title.includes('教师招引'))).toBe(true);
      expect(label).toContain('教师招聘');
    },
  );

  it('绍兴教师招聘正文与附件按官方协议解析', () => {
    const manifest = readManifest('shaoxing', 'public-detail-manifest.json');
    const file = manifest.files[0];
    const bytes = readFileSync(path.join(fixtureDir('shaoxing'), file.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const article = locateOfficialArticle(file.url, bytes.toString('utf8'));
    expect(article.title).toContain('教师招引');
    expect(article.publishedAt).toBe('2026-07-06');
    expect(article.bodyText).toContain('拟录用');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain(
      '/api-gateway/jpaas-web-server/front/document/download?',
    );
    expect(article.attachments[0].name).toContain('公示名单');
  });

  it('嘉兴人才招聘真实接口与正文解析一致', () => {
    const manifest = readManifest('jiaxing', 'public-list-manifest.json');
    const file = manifest.files[0];
    const bytes = readFileSync(path.join(fixtureDir('jiaxing'), file.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const items = discoverPublicColumn(
      file.url,
      bytes.toString('utf8'),
      'jiaxing',
    );
    expect(items.length).toBeGreaterThan(5);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);
    // 列表只给 10/15 这类短日期，年份必须来自官方文章路径
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    const detail = readManifest('jiaxing', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('jiaxing'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘优秀教师公告');
    expect(article.publishedAt).toBe('2026-10-15');
    expect(article.bodyText.length).toBeGreaterThan(500);
    expect(article.attachments.length).toBeGreaterThanOrEqual(2);
  });

  it('苏州静态列表、分页与正文按官方协议解析', () => {
    const shell = readFixture('suzhou', 'public-shell.html');
    const items = discoverStaticList(
      'https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list.shtml',
      shell,
    );
    expect(items.length).toBeGreaterThan(5);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);
    const pages = staticListPages(
      'https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list.shtml',
      shell,
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toBe(
      'https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list_2.shtml',
    );
    const detail = readManifest('suzhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('suzhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘');
    expect(article.bodyText).toContain('公示');
  });

  it('常州市教育局教师招考列表、分页与正文按官方协议解析', () => {
    const shell = readFixture('changzhou', 'public-shell.html');
    const items = discoverColumnTable(
      'https://jyj.changzhou.gov.cn/class/QFJEPCBL',
      shell,
    );
    expect(items.length).toBeGreaterThan(5);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('招聘'))).toBe(true);

    const pages = columnTablePages(
      'https://jyj.changzhou.gov.cn/class/QFJEPCBL',
      shell,
    );
    expect(pages[0]).toBe('https://jyj.changzhou.gov.cn/class/QFJEPCBL/2');

    // 第 2 页样本独立回放，验证分页结构一致
    const page2 = readFixture('changzhou', 'public-page2.html');
    const page2Items = discoverColumnTable(
      'https://jyj.changzhou.gov.cn/class/QFJEPCBL/2',
      page2,
    );
    expect(page2Items.length).toBeGreaterThan(3);

    const detail = readManifest('changzhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('changzhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    // 公示类公告正文本身较短，断言真实内容而非长度阈值
    expect(article.title).toContain('公开招聘教师');
    expect(article.publishedAt).toBe('2026-10-22');
    expect(article.bodyText).toContain('拟聘用人员');
    // 官方附件走站点内 /uploadfile/ 链接
    expect(article.attachments.length).toBeGreaterThanOrEqual(1);
    expect(article.attachments[0].url).toContain('/uploadfile/');
    expect(article.attachments[0].name).toContain('体检人选名单');
  });

  it('蚌埠市教育局教师招聘列表、分页与正文按官方协议解析', () => {
    const shell = readFixture('bengbu', 'public-shell.html');
    const items = discoverServerRenderedList(
      'https://jyj.bengbu.gov.cn/xwdt/kszp/',
      shell,
      /\/xwdt\/kszp\/\d+\.html$/,
    );
    expect(items.length).toBeGreaterThan(5);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('教师'))).toBe(true);
    // 条目 URL 必须落在官方教师招聘栏目路径下
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.bengbu\.gov\.cn\/xwdt\/kszp\/\d+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);

    // 官方 pageCount 分页：后续页为 /content/column/<id>?pageIndex=N
    const pages = serverRenderedListPages(
      'https://jyj.bengbu.gov.cn/xwdt/kszp/',
      shell,
      '6820881',
      'https://jyj.bengbu.gov.cn',
    );
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toBe(
      'https://jyj.bengbu.gov.cn/content/column/6820881?pageIndex=2',
    );

    // 第 2 页样本独立回放，验证分页结构一致
    const page2 = readFixture('bengbu', 'public-page2.html');
    const page2Items = discoverServerRenderedList(
      'https://jyj.bengbu.gov.cn/content/column/6820881?pageIndex=2',
      page2,
      /\/xwdt\/kszp\/\d+\.html$/,
    );
    expect(page2Items.length).toBeGreaterThan(3);

    const detail = readManifest('bengbu', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('bengbu'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('教师');
    expect(article.publishedAt).toBe('2026-08-07');
    expect(article.bodyText.length).toBeGreaterThan(100);
    // 官方附件走站点内 /group4/ 对象存储链接
    expect(article.attachments.length).toBeGreaterThanOrEqual(1);
    expect(article.attachments[0].url).toContain('/group4/');
  });

  it('三个新适配器在真实样本上不抛 DOM 失配', () => {
    const shaoxingList = readFixture('shaoxing', 'public-list.json');
    const jiaxingList = readFixture('jiaxing', 'public-list.json');
    const suzhouShell = readFixture('suzhou', 'public-shell.html');
    expect(
      new ShaoxingEducationAdapter().discover({
        url: SHAOXING_LIST,
        mimeType: 'application/json',
        content: shaoxingList,
        fetchedAt: '2026-10-26T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(3);
    expect(
      new JiaxingEducationAdapter().discover({
        url: 'https://jyj.jiaxing.gov.cn/col/col1569769/index.html',
        mimeType: 'application/json',
        content: jiaxingList,
        fetchedAt: '2026-10-26T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(5);
    expect(
      new SuzhouEducationAdapter().discover({
        url: 'https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list.shtml',
        mimeType: 'text/html',
        content: suzhouShell,
        fetchedAt: '2026-10-26T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(5);
  });

  it('蚌埠适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new BengbuEducationAdapter();
    const shell = readFixture('bengbu', 'public-shell.html');
    const items = adapter.discover({
      url: 'https://jyj.bengbu.gov.cn/xwdt/kszp/',
      mimeType: 'text/html',
      content: shell,
      fetchedAt: '2026-10-26T08:47:12.061Z',
    });
    expect(items.length).toBeGreaterThan(5);
    expect(
      adapter.paginationListings('https://jyj.bengbu.gov.cn/xwdt/kszp/', shell)
        .length,
    ).toBeGreaterThan(0);
    // 该来源是服务端渲染静态列表，误传公开接口 JSON 必须显式失败
    expect(() =>
      adapter.discover({
        url: 'https://jyj.bengbu.gov.cn/xwdt/kszp/',
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<ul></ul>"}}',
        fetchedAt: '2026-10-26T08:47:12.061Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('萧山区教育局教师招考列表、分页与正文按官方协议解析', () => {
    const manifest = readManifest('xiaoshan', 'public-manifest.json');
    const listFile = manifest.files.find((file) =>
      file.name.endsWith('public-list.json'),
    )!;
    const bytes = readFileSync(
      path.join(fixtureDir('xiaoshan'), listFile.name),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(
      listFile.url,
      bytes.toString('utf8'),
      'xiaoshan',
    );
    expect(items.length).toBeGreaterThan(5);
    // 萧山是区县级来源，条目必须落在官方 /art/ 正文路径下
    expect(
      items.every((item) =>
        /^https:\/\/www\.xiaoshan\.gov\.cn\/col\/col1228964830\/art\/\d{4}\/art_[\da-f]+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('教师'))).toBe(true);

    // 官方 paramJson 分页协议：rows=15 / count=173 → 共 12 页
    const pages = publicColumnPages(listFile.url, bytes.toString('utf8'));
    expect(pages.length).toBe(11);
    expect(pages[0]).toContain(
      encodeURIComponent('{"pageNo":2,"pageSize":"15"}'),
    );

    // 第 2 页样本独立回放，验证分页结构一致
    const page2 = readFixture('xiaoshan', 'public-page2.json');
    const page2Items = discoverPublicColumn(pages[0], page2, 'xiaoshan');
    expect(page2Items.length).toBeGreaterThan(3);
    // 第 2 页请求带 paramJson 时不得再生成后续页（避免重复抓取）
    expect(publicColumnPages(pages[0], page2)).toHaveLength(0);

    const detail = readManifest('xiaoshan', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('xiaoshan'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('教师');
    expect(article.publishedAt).toBe('2026-07-20');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments.length).toBeGreaterThanOrEqual(1);
    expect(article.attachments[0].url).toContain('/document/download');
  });

  it('萧山适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new XiaoshanEducationAdapter();
    const list = readFixture('xiaoshan', 'public-list.json');
    const items = adapter.discover({
      url: 'https://www.xiaoshan.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit?parseType=bulidstatic&webId=2243&tplSetId=GazmxWZitZXDWHJedYwxo&pageType=column&tagId=%E5%BD%93%E5%89%8D%E6%A0%8F%E7%9B%AE%E5%88%97%E8%A1%A8&editType=null&pageId=1228964830',
      mimeType: 'application/json',
      content: list,
      fetchedAt: '2026-10-26T08:50:44.919Z',
    });
    expect(items.length).toBeGreaterThan(5);
    expect(
      adapter.pages({
        url: 'https://www.xiaoshan.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit?parseType=bulidstatic&webId=2243&tplSetId=GazmxWZitZXDWHJedYwxo&pageType=column&tagId=%E5%BD%93%E5%89%8D%E6%A0%8F%E7%9B%AE%E5%88%97%E8%A1%A8&editType=null&pageId=1228964830',
        mimeType: 'application/json',
        content: list,
        fetchedAt: '2026-10-26T08:50:44.919Z',
      }).length,
    ).toBe(11);
    // 栏目外壳页本身不含列表数据，误传必须显式失败而不是静默返回 0 条
    expect(() =>
      adapter.discover({
        url: 'https://www.xiaoshan.gov.cn/col/col1228964830/index.html',
        mimeType: 'text/html',
        content: readFixture('xiaoshan', 'public-shell.html'),
        fetchedAt: '2026-10-26T08:50:44.919Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('常州适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new ChangzhouEducationAdapter();
    const shell = readFixture('changzhou', 'public-shell.html');
    const items = adapter.discover({
      url: 'https://jyj.changzhou.gov.cn/class/QFJEPCBL',
      mimeType: 'text/html',
      content: shell,
      fetchedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(items.length).toBeGreaterThan(5);
    expect(
      adapter.paginationListings(
        'https://jyj.changzhou.gov.cn/class/QFJEPCBL',
        shell,
      ).length,
    ).toBeGreaterThan(0);
    // 该来源是静态表格列表，误传公开接口 JSON 必须显式失败
    expect(() =>
      adapter.discover({
        url: 'https://jyj.changzhou.gov.cn/class/QFJEPCBL',
        mimeType: 'application/json',
        content: '{"success":true}',
        fetchedAt: '2026-10-26T00:00:00.000Z',
      }),
    ).toThrow(/静态表格/);
  });

  it('杭州教师招聘真实公开接口、分页、正文与附件按官方协议解析', () => {
    const manifest = readManifest('hangzhou', 'public-manifest.json');
    // 外壳页声明同源公开接口
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shellBytes = readFileSync(
      path.join(fixtureDir('hangzhou'), shellFile.name),
    );
    expect(createHash('sha256').update(shellBytes).digest('hex')).toBe(
      shellFile.sha256,
    );
    const shell = shellBytes.toString('utf8');
    const listUrl = publicColumnRequest(shellFile.url, shell);
    expect(listUrl).toBeTruthy();
    expect(new URL(listUrl!).origin).toBe(new URL(shellFile.url).origin);
    // 官方声明的接口 URL 必须与快照一致（防止接口参数被篡改）
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(listUrl).toBe(listFile.url);

    const listBytes = readFileSync(
      path.join(fixtureDir('hangzhou'), listFile.name),
    );
    expect(createHash('sha256').update(listBytes).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(
      listFile.url,
      listBytes.toString('utf8'),
      'hangzhou',
    );
    expect(items.length).toBeGreaterThan(10);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);
    expect(
      items.every((item) =>
        item.url.startsWith('https://edu.hangzhou.gov.cn/'),
      ),
    ).toBe(true);

    // 分页：官方 div.pagination + paramJson 协议
    const pages = publicColumnPages(listFile.url, listBytes.toString('utf8'));
    expect(pages).toHaveLength(1);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({
      pageNo: 2,
      pageSize: '15',
    });
    const page2File = manifest.files.find(
      (file) => file.name === 'public-page2.json',
    )!;
    const page2Bytes = readFileSync(
      path.join(fixtureDir('hangzhou'), page2File.name),
    );
    expect(createHash('sha256').update(page2Bytes).digest('hex')).toBe(
      page2File.sha256,
    );
    const page2Items = discoverPublicColumn(
      page2File.url,
      page2Bytes.toString('utf8'),
      'hangzhou',
    );
    expect(page2Items.length).toBeGreaterThan(0);
    // 第 2 页条目与第 1 页不得重复
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2Items.every((item) => !firstUrls.has(item.url))).toBe(true);

    // 正文：官方 meta + .art_con + 官方附件下载链接
    const detail = readManifest('hangzhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('hangzhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘公告');
    expect(article.publishedAt).toBe('2026-04-28');
    expect(article.bodyText.length).toBeGreaterThan(1000);
    expect(article.attachments.length).toBe(4);
    expect(
      article.attachments.every((attachment) =>
        attachment.url.includes(
          '/api-gateway/jpaas-web-server/front/document/download?',
        ),
      ),
    ).toBe(true);
    expect(article.attachments[0].name).toContain('招聘计划表');
  });

  it('杭州适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new HangzhouEducationAdapter();
    const manifest = readManifest('hangzhou', 'public-manifest.json');
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    const items = adapter.discover({
      url: listFile.url,
      mimeType: 'application/json',
      content: readFixture('hangzhou', 'public-list.json'),
      fetchedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(items.length).toBeGreaterThan(10);
    const detail = readManifest('hangzhou', 'public-detail-manifest.json');
    const article = adapter.locateArticle({
      url: detail.files[0].url,
      mimeType: 'text/html',
      content: readFixture('hangzhou', 'public-detail.html'),
      fetchedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(article.title).toContain('公开招聘公告');
    expect(article.attachments.length).toBe(4);
  });

  it('结构变化显式失败，绝不静默返回 0 条', () => {
    expect(() =>
      discoverStaticList(
        'https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list.shtml',
        '<ul></ul>',
      ),
    ).toThrow(/结构/);
    expect(() =>
      discoverPublicColumn(
        'https://jyj.sx.gov.cn/x',
        JSON.stringify({
          success: true,
          data: { html: '<div class="page-content"></div>' },
        }),
        'shaoxing',
      ),
    ).toThrow(/空列表/);
    expect(() =>
      locateOfficialArticle(
        'https://jyj.sx.gov.cn/x',
        '<html><body><p>空</p></body></html>',
      ),
    ).toThrow(/容器/);
  });
});

/**
 * 丽水市教育局「人事招聘」栏目真实核验（2026-10-26）。
 *
 * 该来源与既有 jpaas 来源的差异点，必须被测试锁住：
 * 1. 外壳页 queryData 含 pageId，必须完整透传才能取到列表；
 * 2. 分页参数不在 DOM 属性上，而在官方内联脚本 initJpage({...}) 中；
 * 3. 列表有两种官方单元（表格 tr / ajax 分页 li），日期都是方括号格式。
 */
describe('S5 丽水「人事招聘」真实样本回放', () => {
  it('外壳页解析出的同源公开接口与真实快照 URL 一致', () => {
    const shell = readFixture('lishui', 'public-shell.html');
    const request = publicColumnRequest(
      'https://jyj.lishui.gov.cn/col/col1229223905/index.html',
      shell,
    );
    expect(request).toBeTruthy();
    const manifest = readManifest('lishui', 'public-manifest.json');
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(request).toBe(listFile.url);
    // 丽水的 pageId 是必需参数：缺失即拿不到列表。
    expect(request).toContain('pageId=1229223905');
    expect(request).toContain('tagId=');
  });

  it('真实列表快照解析出教师招聘公告且日期完整', () => {
    const manifest = readManifest('lishui', 'public-manifest.json');
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    const bytes = readFileSync(path.join(fixtureDir('lishui'), listFile.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(
      listFile.url,
      bytes.toString('utf8'),
      'lishui',
    );
    expect(items.length).toBeGreaterThan(5);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.some(
        (item) =>
          item.title.includes('公开招聘') ||
          item.title.includes('公开招（选）聘'),
      ),
    ).toBe(true);
    expect(
      items.every((item) => item.url.startsWith('https://jyj.lishui.gov.cn/')),
    ).toBe(true);
  });

  it('分页参数来自官方 initJpage 内联配置，后续页与首页不重复', () => {
    const manifest = readManifest('lishui', 'public-manifest.json');
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    const pages = publicColumnPages(
      listFile.url,
      readFixture('lishui', 'public-list.json'),
    );
    expect(pages.length).toBeGreaterThan(0);
    // 丽水每页 10 条，paramJson 必须沿用官方 pageSize。
    expect(pages[0]).toContain(
      encodeURIComponent(JSON.stringify({ pageNo: 2, pageSize: '10' })),
    );
    const page2 = pages[0];
    // 已请求过具体页码时不再重复安排后续页。
    expect(
      publicColumnPages(page2, readFixture('lishui', 'public-page2.json')),
    ).toEqual([]);
    const first = discoverPublicColumn(
      listFile.url,
      readFixture('lishui', 'public-list.json'),
      'lishui',
    );
    const second = discoverPublicColumn(
      page2,
      readFixture('lishui', 'public-page2.json'),
      'lishui',
    );
    const firstUrls = new Set(first.map((item) => item.url));
    expect(second.some((item) => firstUrls.has(item.url))).toBe(false);
  });

  it('真实正文与官方附件下载链接按 jpaas 协议解析', () => {
    const manifest = readManifest('lishui', 'public-detail-manifest.json');
    const file = manifest.files[0];
    const bytes = readFileSync(path.join(fixtureDir('lishui'), file.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const article = locateOfficialArticle(file.url, bytes.toString('utf8'));
    expect(article.title).toContain('公开招聘');
    expect(article.publishedAt).toBe('2026-08-08');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments.length).toBeGreaterThan(0);
    expect(
      article.attachments.every((attachment) =>
        attachment.url.includes(
          '/api-gateway/jpaas-web-server/front/document/download?',
        ),
      ),
    ).toBe(true);
    expect(article.attachments[0].name).toContain('xlsx');
  });

  it('丽水适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new LishuiEducationAdapter();
    const manifest = readManifest('lishui', 'public-manifest.json');
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    const items = adapter.discover({
      url: listFile.url,
      mimeType: 'application/json',
      content: readFixture('lishui', 'public-list.json'),
      fetchedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(items.length).toBeGreaterThan(5);
    const detail = readManifest('lishui', 'public-detail-manifest.json');
    const article = adapter.locateArticle({
      url: detail.files[0].url,
      mimeType: 'text/html',
      content: readFixture('lishui', 'public-detail.html'),
      fetchedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(article.title).toContain('公开招聘');
    expect(article.attachments.length).toBeGreaterThan(0);
  });
});

/**
 * 所有真实来源快照的 manifest 必须使用统一 schema：
 * 顶层 capturedAt / sourceKind / scope / stableMonitoringVerified，
 * 文件清单统一放在 files[]（name / url / sha256）。
 * 混用旧的扁平 {url, sha256} 结构会让校验逻辑分叉，必须在测试里拦住。
 */
const MANIFEST_SOURCES = [
  'ningbo',
  'yinzhou',
  'shaoxing',
  'jiaxing',
  'suzhou',
  'changzhou',
  'hangzhou',
  'lishui',
  'bengbu',
  'xiaoshan',
  'huzhou',
  'taizhou',
  'bozhou',
  'fuyang',
  'jinan',
  'yantai',
] as const;

describe('S5 真实快照 manifest schema 统一', () => {
  it.each(MANIFEST_SOURCES)(
    '%s 的所有 manifest 使用 files[] 结构且哈希与文件一致',
    (key) => {
      const dir = fixtureDir(key);
      const files = readdirSync(dir).filter((name) =>
        name.endsWith('manifest.json'),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const name of files) {
        const manifest = JSON.parse(
          readFileSync(path.join(dir, name), 'utf8'),
        ) as {
          capturedAt?: string;
          sourceKind?: string;
          scope?: string;
          stableMonitoringVerified?: boolean;
          files?: { name: string; url: string; sha256: string }[];
        };
        expect(manifest.capturedAt, name).toBeTruthy();
        expect(manifest.sourceKind, name).toBe('official-live-snapshot');
        expect(manifest.scope, name).toBeTruthy();
        // 持续监测未验证前不得声称正常监测。
        expect(manifest.stableMonitoringVerified, name).toBe(false);
        expect(Array.isArray(manifest.files), name).toBe(true);
        expect(manifest.files!.length, name).toBeGreaterThan(0);
        for (const file of manifest.files!) {
          expect(file.url, name).toMatch(/^https:\/\//);
          const bytes = readFileSync(path.join(dir, file.name));
          expect(
            createHash('sha256').update(bytes).digest('hex'),
            `${name}:${file.name}`,
          ).toBe(file.sha256);
        }
      }
    },
  );

  it('详情页 manifest 的 scope 不使用列表发现口径', () => {
    for (const key of MANIFEST_SOURCES) {
      const dir = fixtureDir(key);
      const name = 'public-detail-manifest.json';
      if (!existsSync(path.join(dir, name))) continue;
      const manifest = JSON.parse(
        readFileSync(path.join(dir, name), 'utf8'),
      ) as { scope?: string };
      expect(manifest.scope, key).toBe('article-and-attachment-links-only');
    }
  });

  it('快照目录声明 -text，保证 Git blob 字节与 manifest 哈希一致', () => {
    // manifest 记录的是官网真实响应的 sha256。若 Git 在 checkout 时做行尾转换，
    // Linux / CI 上工作区字节会与哈希失配，回放测试必然失败。
    // 因此快照目录必须用 .gitattributes 把 * 标记为 -text（不做任何转换）。
    const root = path.resolve(
      process.cwd(),
      '../tests/fixtures/golden-sources',
    );
    const attr = path.join(root, '.gitattributes');
    expect(
      existsSync(attr),
      '缺少 tests/fixtures/golden-sources/.gitattributes',
    ).toBe(true);
    const text = readFileSync(attr, 'utf8');
    expect(text).toMatch(/^\*\s+-text\s*$/m);
  });
});

const SHAOXING_LIST =
  'https://jyj.sx.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit';

/**
 * N1 首批跨省扩源（2026-11-05）：浙江湖州、江苏泰州、安徽亳州。
 *
 * 三个来源覆盖三种此前未接入的形态：
 * - 湖州：jpaas 表格行 + td.yd_no 日期 + initJpage 内联分页；
 * - 泰州：jpaas li + span 日期，title 为模板占位符 `{item.title1}`；
 * - 亳州：服务端渲染 section.m-tglist + <pagination> pagecount 分页。
 */
describe('N1 跨省首批来源真实样本回放', () => {
  it('湖州公示公告：外壳接口、列表、分页与正文附件一致', () => {
    const manifest = readManifest('huzhou', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shell = readFixture('huzhou', 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const listUrl = publicColumnRequest(shellFile.url, shell);
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(listUrl).toBe(listFile.url);
    expect(listUrl).toContain('pageId=1229210603');
    expect(listUrl).toContain('tagId=');

    const list = readFixture('huzhou', 'public-list.json');
    expect(createHash('sha256').update(list).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(listFile.url, list, 'huzhou');
    expect(items.length).toBeGreaterThan(8);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('引进'))).toBe(true);
    // 条目必须落在官方文章路径 /col/col1229210603/art/YYYY/ 下
    expect(
      items.every((item) =>
        /^https:\/\/huedu\.huzhou\.gov\.cn\/col\/col1229210603\/art\/\d{4}\/art_[\da-f]+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);

    // 官方 initJpage：rows=15 / count=41 → 共 3 页，后续 2 页
    const pages = publicColumnPages(listFile.url, list);
    expect(pages).toHaveLength(2);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 2, pageSize: '15' });
    const page2 = discoverPublicColumn(
      pages[0],
      readFixture('huzhou', 'public-page2.json'),
      'huzhou',
    );
    expect(page2.length).toBeGreaterThan(5);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    const detail = readManifest('huzhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('huzhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('引进');
    expect(article.publishedAt).toBe('2026-11-04');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain(
      '/api-gateway/jpaas-web-server/front/document/download?',
    );
    expect(article.attachments[0].name).toContain('.xlsx');
  });

  it('泰州最新文件：模板占位标题回退、分页与正文附件一致', () => {
    const manifest = readManifest('taizhou', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(createHash('sha256').update(readFixture('taizhou', 'public-shell.html')).digest('hex')).toBe(shellFile.sha256);
    expect(publicColumnRequest(shellFile.url, readFixture('taizhou', 'public-shell.html'))).toBe(listFile.url);

    const list = readFixture('taizhou', 'public-list.json');
    expect(createHash('sha256').update(list).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(listFile.url, list, 'taizhou');
    expect(items.length).toBeGreaterThan(8);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    // title 属性是 {item.title1} 占位符，标题必须回退到链接文本
    expect(items.every((item) => !item.title.includes('{'))).toBe(true);
    expect(items.some((item) => item.title.includes('教师资格'))).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.taizhou\.gov\.cn\/zxwj\/art\/\d{4}\/art_[\da-f]+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);

    // 官方 DOM 属性：rows=15 / count=30 → 共 2 页，后续 1 页
    const pages = publicColumnPages(listFile.url, list);
    expect(pages).toHaveLength(1);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 2, pageSize: '15' });
    const page2 = discoverPublicColumn(
      pages[0],
      readFixture('taizhou', 'public-page2.json'),
      'taizhou',
    );
    expect(page2.length).toBeGreaterThan(3);

    const detail = readManifest('taizhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('taizhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘教师');
    expect(article.publishedAt).toBe('2026-08-20');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain(
      '/api-gateway/jpaas-web-server/front/document/download?',
    );
    expect(article.attachments[0].name).toContain('.xls');
  });

  it('亳州教师管理：静态列表、pagination 分页与正文附件一致', () => {
    const manifest = readManifest('bozhou', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shell = readFixture('bozhou', 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const items = discoverGovInfoList(
      shellFile.url,
      shell,
      /\/OpennessContent\/show\/\d+\.html(?:[?#]|$)/,
    );
    expect(items.length).toBeGreaterThan(8);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.some(
        (item) => item.title.includes('公开招聘') || item.title.includes('招募'),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        item.url.startsWith('https://www.bozhou.gov.cn/OpennessContent/show/'),
      ),
    ).toBe(true);

    // 官方 pagination：pagecount=13 → 后续 12 页（page_2..page_13.html）
    const pages = govInfoListPages(shellFile.url, shell);
    expect(pages).toHaveLength(12);
    expect(pages[0]).toBe(
      'https://www.bozhou.gov.cn/XxgkContent/showList/295/65767/page_2.html',
    );
    const page2 = discoverGovInfoList(
      pages[0],
      readFixture('bozhou', 'public-page2.html'),
      /\/OpennessContent\/show\/\d+\.html(?:[?#]|$)/,
    );
    expect(page2.length).toBeGreaterThan(8);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);
    // 已在后续页时不再重复安排分页
    expect(govInfoListPages(pages[0], readFixture('bozhou', 'public-page2.html'))).toEqual([]);

    const detail = readManifest('bozhou', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('bozhou'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('招募');
    expect(article.publishedAt).toBe('2026-09-01');
    expect(article.bodyText.length).toBeGreaterThan(100);
    // 官方附件走 /upload_bz/download?siteId=1&id=...（.doc/.et）
    expect(article.attachments).toHaveLength(3);
    expect(
      article.attachments.every(
        (attachment) =>
          attachment.url.includes('/upload_bz/download?') &&
          /\.(doc|et)【/i.test(attachment.name),
      ),
    ).toBe(true);
  });

  it('三个 N1 适配器在真实样本上不抛 DOM 失配', () => {
    const huzhou = new HuzhouEducationAdapter();
    const huzhouList = readManifest('huzhou', 'public-manifest.json').files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(
      huzhou.discover({
        url: huzhouList.url,
        mimeType: 'application/json',
        content: readFixture('huzhou', 'public-list.json'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(8);
    expect(() =>
      huzhou.discover({
        url: 'https://huedu.huzhou.gov.cn/col/col1229210603/index.html',
        mimeType: 'text/html',
        content: readFixture('huzhou', 'public-shell.html'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);

    const taizhou = new TaizhouEducationAdapter();
    const taizhouList = readManifest(
      'taizhou',
      'public-manifest.json',
    ).files.find((file) => file.name === 'public-list.json')!;
    expect(
      taizhou.discover({
        url: taizhouList.url,
        mimeType: 'application/json',
        content: readFixture('taizhou', 'public-list.json'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(8);

    const bozhou = new BozhouEducationAdapter();
    const bozhouShell = readFixture('bozhou', 'public-shell.html');
    expect(
      bozhou.discover({
        url: 'https://www.bozhou.gov.cn/XxgkContent/showList/295/65767/page_1.html',
        mimeType: 'text/html',
        content: bozhouShell,
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }).length,
    ).toBeGreaterThan(8);
    expect(bozhou.paginationListings(
      'https://www.bozhou.gov.cn/XxgkContent/showList/295/65767/page_1.html',
      bozhouShell,
    )).toHaveLength(12);
    expect(() =>
      bozhou.discover({
        url: 'https://www.bozhou.gov.cn/XxgkContent/showList/295/65767/page_1.html',
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<ul></ul>"}}',
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toThrow(/静态列表/);
  });

  it('阜阳师资建设：CMS 静态列表、跨站过滤、pagination 与正文附件一致', () => {
    const manifest = readManifest('fuyang', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shell = readFixture('fuyang', 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const items = discoverGovInfoList(
      shellFile.url,
      shell,
      /\/Content\/show\/\d+\.html(?:[?#]|$)/,
    );
    // 首屏 15 行中 5 条为省厅/教育部跨站转载，只保留本域 10 条
    expect(items).toHaveLength(10);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) =>
        item.url.startsWith('https://edu.fy.gov.cn/Content/show/'),
      ),
    ).toBe(true);
    expect(
      items.some(
        (item) =>
          item.title.includes('公开招聘') || item.title.includes('选聘教师'),
      ),
    ).toBe(true);

    // 官方 pagination：pagecount=12 → 后续 11 页（page_2..page_12.html）
    const pages = govInfoListPages(shellFile.url, shell);
    expect(pages).toHaveLength(11);
    expect(pages[0]).toBe(
      'https://edu.fy.gov.cn/Content/showList/843/page_2.html',
    );
    const page2 = discoverGovInfoList(
      pages[0],
      readFixture('fuyang', 'public-page2.html'),
      /\/Content\/show\/\d+\.html(?:[?#]|$)/,
    );
    expect(page2.length).toBeGreaterThan(5);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    const detail = readManifest('fuyang', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('fuyang'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('新任教师公开招聘');
    expect(article.publishedAt).toBe('2026-07-15');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain('/download?siteId=28&id=');
    expect(article.attachments[0].name).toContain('.xlsx');
  });

  it('阜阳适配器在真实样本上不抛 DOM 失配', () => {
    const adapter = new FuyangEducationAdapter();
    const shell = readFixture('fuyang', 'public-shell.html');
    const base =
      'https://edu.fy.gov.cn/Content/showList/843/page_1.html';
    expect(
      adapter.discover({
        url: base,
        mimeType: 'text/html',
        content: shell,
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toHaveLength(10);
    expect(adapter.paginationListings(base, shell)).toHaveLength(11);
    expect(() =>
      adapter.discover({
        url: base,
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<ul></ul>"}}',
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toThrow(/静态列表/);
  });
});

/**
 * N2 公开接口族跨省扩源（2026-11-05）：济南市教育局「教师招聘专栏」。
 *
 * 与既有 jpaas 来源共用外壳 → 公开接口协议，但列表单元与分页形态不同：
 * 表格行 + td.bt_time 日期 + DOM 属性分页（rows=15 / count=79）。
 */
describe('N2 公开接口族来源真实样本回放', () => {
  it('济南教师招聘专栏：外壳接口、列表、分页与正文附件一致', () => {
    const manifest = readManifest('jinan', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shell = readFixture('jinan', 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const listUrl = publicColumnRequest(shellFile.url, shell);
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(listUrl).toBe(listFile.url);
    expect(listUrl).toContain('pageId=19032');

    const list = readFixture('jinan', 'public-list.json');
    expect(createHash('sha256').update(list).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(listFile.url, list, 'jinan');
    expect(items).toHaveLength(15);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);
    expect(
      items.every((item) =>
        // 官网部分历史条目仍给 http 绝对链接，只校验同域与官方文章路径。
        /^http:\/\/jnedu\.jinan\.gov\.cn\/col\/col\d+\/art\/\d{4}\/art_[\da-f]+\.html$/.test(
          item.url,
        ) ||
        /^https:\/\/jnedu\.jinan\.gov\.cn\/col\/col\d+\/art\/\d{4}\/art_[\da-f]+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);

    // 官方 DOM 属性：rows=15 / count=79 → 共 6 页，后续 5 页
    const pages = publicColumnPages(listFile.url, list);
    expect(pages).toHaveLength(5);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 2, pageSize: '15' });
    const page2 = discoverPublicColumn(
      pages[0],
      readFixture('jinan', 'public-page2.json'),
      'jinan',
    );
    expect(page2.length).toBeGreaterThan(5);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    const detail = readManifest('jinan', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('jinan'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘人员公告');
    expect(article.publishedAt).toBe('2026-04-16');
    expect(article.bodyText.length).toBeGreaterThan(100);
    // 官方 4 个附件（岗位汇总表 PDF、应聘须知 PDF、同意报考证明 doc、身份认定表 docx）
    expect(article.attachments).toHaveLength(4);
    expect(
      article.attachments.every((attachment) =>
        attachment.url.includes(
          '/api-gateway/jpaas-web-server/front/document/download?',
        ),
      ),
    ).toBe(true);
  });

  it('济南适配器在真实样本上不抛 DOM 失配，外壳页显式失败', () => {
    const adapter = new JinanEducationAdapter();
    const listFile = readManifest('jinan', 'public-manifest.json').files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(
      adapter.discover({
        url: listFile.url,
        mimeType: 'application/json',
        content: readFixture('jinan', 'public-list.json'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toHaveLength(15);
    expect(
      adapter.pages({
        url: listFile.url,
        mimeType: 'application/json',
        content: readFixture('jinan', 'public-list.json'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toHaveLength(5);
    expect(() =>
      adapter.discover({
        url: 'https://jnedu.jinan.gov.cn/col/col19032/index.html',
        mimeType: 'text/html',
        content: readFixture('jinan', 'public-shell.html'),
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);
    expect(() =>
      adapter.discover({
        url: listFile.url,
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<div></div>"}}',
        fetchedAt: '2026-11-05T00:00:00.000Z',
      }),
    ).toThrow(/空列表|结构变化/);
  });

  it('烟台通知公告：外壳接口、列表、分页窗口与正文附件一致', () => {
    const manifest = readManifest('yantai', 'public-manifest.json');
    const shellFile = manifest.files.find(
      (file) => file.name === 'public-shell.html',
    )!;
    const shell = readFixture('yantai', 'public-shell.html');
    expect(createHash('sha256').update(shell).digest('hex')).toBe(
      shellFile.sha256,
    );
    const listUrl = publicColumnRequest(shellFile.url, shell);
    const listFile = manifest.files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(listUrl).toBe(listFile.url);
    expect(listUrl).toContain('pageId=17078');

    const list = readFixture('yantai', 'public-list.json');
    expect(createHash('sha256').update(list).digest('hex')).toBe(
      listFile.sha256,
    );
    const items = discoverPublicColumn(listFile.url, list, 'yantai');
    // 首屏 15 行中有 3 条直接指向 PDF（年度报表、职称通知、教辅目录），
    // 只保留 12 条官方文章页；历史条目 /art/YYYY/ 与新版 /col/.../art/YYYY/ 都可识别。
    expect(items).toHaveLength(12);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(items.some((item) => item.title.includes('公开招聘'))).toBe(true);
    expect(
      items.every((item) =>
        /^https:\/\/jyj\.yantai\.gov\.cn\/(?:col\/col17078\/)?art\/\d{4}\/\S+\.html$/.test(
          item.url,
        ),
      ),
    ).toBe(true);

    // 官方分量 1365 条 / 91 页，远超通用预算；按来源窗口只安排最新 6 页中的后续 5 页。
    const pages = publicColumnPages(listFile.url, list);
    expect(pages).toHaveLength(5);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 2, pageSize: '15' });
    expect(
      JSON.parse(new URL(pages[4]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 6, pageSize: '15' });
    const page2 = discoverPublicColumn(
      pages[0],
      readFixture('yantai', 'public-page2.json'),
      'yantai',
    );
    expect(page2).toHaveLength(15);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    const detail = readManifest('yantai', 'public-detail-manifest.json');
    const detailFile = detail.files[0];
    const detailBytes = readFileSync(
      path.join(fixtureDir('yantai'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘');
    expect(article.publishedAt).toBe('2026-10-30');
    expect(article.bodyText).toContain('拟聘用人员');
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toContain(
      '/api-gateway/jpaas-web-server/front/document/download?',
    );
    expect(article.attachments[0].name).toContain('.xls');
  });

  it('烟台适配器在真实样本上不抛 DOM 失配，外壳页显式失败', () => {
    const adapter = new YantaiEducationAdapter();
    const listFile = readManifest('yantai', 'public-manifest.json').files.find(
      (file) => file.name === 'public-list.json',
    )!;
    expect(
      adapter.discover({
        url: listFile.url,
        mimeType: 'application/json',
        content: readFixture('yantai', 'public-list.json'),
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toHaveLength(12);
    expect(
      adapter.pages({
        url: listFile.url,
        mimeType: 'application/json',
        content: readFixture('yantai', 'public-list.json'),
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toHaveLength(5);
    expect(() =>
      adapter.discover({
        url: 'https://jyj.yantai.gov.cn/col/col17078/index.html',
        mimeType: 'text/html',
        content: readFixture('yantai', 'public-shell.html'),
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toThrow(AdapterParseError);
  });

  it('南昌教师科：静态锚点列表、createPageHTML 分页与正文附件一致', () => {
    const manifest = readManifest('nanchang', 'public-manifest.json');
    const list1File = manifest.files.find(
      (file) => file.name === 'public-list-1.html',
    )!;
    const list1 = readFixture('nanchang', 'public-list-1.html');
    expect(createHash('sha256').update(list1).digest('hex')).toBe(
      list1File.sha256,
    );
    const detailPattern = /\/ncjyj\/[a-z]+\/\d{6}\/[a-f0-9]{32}\.shtml(?:[?#]|$)/;
    const items = discoverStaticAnchorList(list1File.url, list1, detailPattern);
    // 官方声明首屏 25 条（含 1 条跨栏目 /ncjyj/jszgrd/ 链接）
    expect(items).toHaveLength(25);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) => item.url.startsWith('https://edu.nc.gov.cn/ncjyj/')),
    ).toBe(true);
    // 教师招聘相关条目（混合栏目按标题判定）
    expect(
      items.some((item) => item.title.includes('中小学教师招聘面试公告')),
    ).toBe(true);
    expect(
      items.some((item) => item.title.includes('引进急需紧缺人才')),
    ).toBe(true);

    // 官方 createPageHTML 分页：2 页 → 后续页 nav_list_2.shtml
    const pages = staticListPages(list1File.url, list1);
    expect(pages).toEqual([
      'https://edu.nc.gov.cn/ncjyj/jskfw/nav_list_2.shtml',
    ]);
    const list2File = manifest.files.find(
      (file) => file.name === 'public-list-2.html',
    )!;
    const list2 = readFixture('nanchang', 'public-list-2.html');
    expect(createHash('sha256').update(list2).digest('hex')).toBe(
      list2File.sha256,
    );
    const page2 = discoverStaticAnchorList(list2File.url, list2, detailPattern);
    expect(page2).toHaveLength(9);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    // 正文：官方 meta + #zoom；附件为相对路径 <文章ID>/files/ 下 xlsx/pdf
    const detail = readManifest('nanchang', 'public-detail-manifest.json');
    const detailFile = detail.files.find(
      (file) => file.name === 'public-detail.html',
    )!;
    const detailBytes = readFileSync(
      path.join(fixtureDir('nanchang'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('中小学教师招聘面试公告');
    expect(article.publishedAt).toBe('2026-07-21');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments).toHaveLength(3);
    expect(
      article.attachments.every((attachment) =>
        attachment.url.startsWith(
          'https://edu.nc.gov.cn/ncjyj/jskfw/202607/433e3b358909465ea328d1e7d1827895/files/',
        ),
      ),
    ).toBe(true);
    expect(
      article.attachments.filter((attachment) =>
        /\.xlsx$/i.test(attachment.url),
      ),
    ).toHaveLength(2);

    // 跨栏目详情（/ncjyj/jszgrd/ 教师资格专栏）：同样按官方 meta + #zoom 解析
    const crossFile = detail.files.find(
      (file) => file.name === 'public-detail-cross.html',
    )!;
    const crossBytes = readFileSync(
      path.join(fixtureDir('nanchang'), crossFile.name),
    );
    expect(createHash('sha256').update(crossBytes).digest('hex')).toBe(
      crossFile.sha256,
    );
    const cross = locateOfficialArticle(
      crossFile.url,
      crossBytes.toString('utf8'),
    );
    expect(cross.title).toContain('引进急需紧缺人才');
    expect(cross.publishedAt).toBe('2026-05-25');
    expect(cross.attachments).toHaveLength(1);
    expect(cross.attachments[0].url).toContain('/ncjyj/jszgrd/202605/');
    expect(cross.attachments[0].url).toMatch(/\.doc$/i);
  });

  it('南昌适配器在真实样本上不抛 DOM 失配，JSON 输入显式拒绝', () => {
    const adapter = new NanchangEducationAdapter();
    const list1File = readManifest('nanchang', 'public-manifest.json').files.find(
      (file) => file.name === 'public-list-1.html',
    )!;
    expect(
      adapter.discover({
        url: list1File.url,
        mimeType: 'text/html',
        content: readFixture('nanchang', 'public-list-1.html'),
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toHaveLength(25);
    expect(() =>
      adapter.discover({
        url: list1File.url,
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<ul></ul>"}}',
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toThrow(/静态列表/);
    const detailFile = readManifest(
      'nanchang',
      'public-detail-manifest.json',
    ).files.find((file) => file.name === 'public-detail.html')!;
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: readFixture('nanchang', 'public-detail.html'),
      fetchedAt: '2026-11-06T00:00:00.000Z',
    });
    expect(article.title).toContain('中小学教师招聘面试公告');
    expect(article.attachments).toHaveLength(3);
  });

  it('太原通知公告：JS 跳转分页、列表锚点与正文附件一致', () => {
    const manifest = readManifest('taiyuan', 'public-manifest.json');
    const list1File = manifest.files.find(
      (file) => file.name === 'public-list-1.html',
    )!;
    const list1 = readFixture('taiyuan', 'public-list-1.html');
    expect(createHash('sha256').update(list1).digest('hex')).toBe(
      list1File.sha256,
    );
    const detailPattern = /\/tzgg\/\d{8}\/\d+\.html(?:[?#]|$)/;
    const items = discoverStaticAnchorList(
      list1File.url,
      list1,
      detailPattern,
      'ul.List_list li',
    );
    expect(items).toHaveLength(20);
    expect(
      items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)),
    ).toBe(true);
    expect(
      items.every((item) => item.url.startsWith('https://jyj.taiyuan.gov.cn/tzgg/')),
    ).toBe(true);
    expect(
      items.some((item) => item.title.includes('公开招聘博士研究生')),
    ).toBe(true);

    // 官方 JS 跳转分页：共 93 条 / 5 页，页码由 onclick location.href 声明
    const pages = jsPaginationPages(list1File.url, list1);
    expect(pages).toEqual([
      'https://jyj.taiyuan.gov.cn/tzgg_2.html',
      'https://jyj.taiyuan.gov.cn/tzgg_3.html',
      'https://jyj.taiyuan.gov.cn/tzgg_4.html',
      'https://jyj.taiyuan.gov.cn/tzgg_5.html',
    ]);
    // 第 1 页链接（tzgg.html）不是“后续页”，不得混入
    expect(pages).not.toContain('https://jyj.taiyuan.gov.cn/tzgg.html');
    const list2File = manifest.files.find(
      (file) => file.name === 'public-list-2.html',
    )!;
    const list2 = readFixture('taiyuan', 'public-list-2.html');
    expect(createHash('sha256').update(list2).digest('hex')).toBe(
      list2File.sha256,
    );
    const page2 = discoverStaticAnchorList(
      list2File.url,
      list2,
      detailPattern,
      'ul.List_list li',
    );
    expect(page2).toHaveLength(20);
    const firstUrls = new Set(items.map((item) => item.url));
    expect(page2.every((item) => !firstUrls.has(item.url))).toBe(true);

    // 正文：官方 meta + #zoom；附件为 /u/cms/site28/ 下 xlsx
    const detail = readManifest('taiyuan', 'public-detail-manifest.json');
    const detailFile = detail.files.find(
      (file) => file.name === 'public-detail.html',
    )!;
    const detailBytes = readFileSync(
      path.join(fixtureDir('taiyuan'), detailFile.name),
    );
    expect(createHash('sha256').update(detailBytes).digest('hex')).toBe(
      detailFile.sha256,
    );
    const article = locateOfficialArticle(
      detailFile.url,
      detailBytes.toString('utf8'),
    );
    expect(article.title).toContain('公开招聘博士研究生拟聘用人员公示');
    expect(article.publishedAt).toBe('2026-09-16');
    expect(article.bodyText.length).toBeGreaterThan(100);
    expect(article.attachments).toHaveLength(1);
    expect(article.attachments[0].url).toBe(
      'https://jyj.taiyuan.gov.cn/u/cms/site28/202609/16091734m19f.xlsx',
    );

    // 同构正文的零附件条目：不得因无附件而失败
    const second = detail.files.find(
      (file) => file.name === 'public-detail-2.html',
    )!;
    const secondBytes = readFileSync(
      path.join(fixtureDir('taiyuan'), second.name),
    );
    expect(createHash('sha256').update(secondBytes).digest('hex')).toBe(
      second.sha256,
    );
    const secondArticle = locateOfficialArticle(
      second.url,
      secondBytes.toString('utf8'),
    );
    expect(secondArticle.title).toContain('职称评审工作');
    expect(secondArticle.publishedAt).toBe('2026-09-11');
    expect(secondArticle.attachments).toHaveLength(0);
  });

  it('太原适配器在真实样本上不抛 DOM 失配，JSON 输入显式拒绝', () => {
    const adapter = new TaiyuanEducationAdapter();
    const list1File = readManifest('taiyuan', 'public-manifest.json').files.find(
      (file) => file.name === 'public-list-1.html',
    )!;
    expect(
      adapter.discover({
        url: list1File.url,
        mimeType: 'text/html',
        content: readFixture('taiyuan', 'public-list-1.html'),
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toHaveLength(20);
    expect(() =>
      adapter.discover({
        url: list1File.url,
        mimeType: 'application/json',
        content: '{"success":true,"data":{"html":"<ul></ul>"}}',
        fetchedAt: '2026-11-06T00:00:00.000Z',
      }),
    ).toThrow(/静态列表/);
    const detailFile = readManifest(
      'taiyuan',
      'public-detail-manifest.json',
    ).files.find((file) => file.name === 'public-detail.html')!;
    const article = adapter.locateArticle({
      url: detailFile.url,
      mimeType: 'text/html',
      content: readFixture('taiyuan', 'public-detail.html'),
      fetchedAt: '2026-11-06T00:00:00.000Z',
    });
    expect(article.title).toContain('公开招聘博士研究生拟聘用人员公示');
    expect(article.attachments).toHaveLength(1);
  });
});
