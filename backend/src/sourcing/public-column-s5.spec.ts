import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  columnTablePages,
  discoverColumnTable,
  discoverPublicColumn,
  discoverStaticList,
  locateOfficialArticle,
  publicColumnPages,
  publicColumnRequest,
  staticListPages,
} from './public-column.js';
import { ShaoxingEducationAdapter } from './adapters/shaoxing-education.adapter.js';
import { JiaxingEducationAdapter } from './adapters/jiaxing-education.adapter.js';
import { SuzhouEducationAdapter } from './adapters/suzhou-education.adapter.js';
import { ChangzhouEducationAdapter } from './adapters/changzhou-education.adapter.js';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { LishuiEducationAdapter } from './adapters/lishui-education.adapter.js';

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
});

const SHAOXING_LIST =
  'https://jyj.sx.gov.cn/api-gateway/jpaas-publish-server/front/page/build/unit';
