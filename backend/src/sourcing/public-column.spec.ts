import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  publicColumnRequest,
  publicColumnPages,
  discoverPublicColumn,
  publicColumnHtml,
  locatePublicArticle,
} from './public-column.js';

const base = 'https://jyj.ningbo.gov.cn/col/col1229166692/index.html';
const script = `<script src="/cms_files/default/script/AuthorizedRead/unitbuild.js" url="/api-gateway/jpaas-publish-server/front/page/build/unit" queryData="{'parseType':'bulidstatic','webId':'3505','tplSetId':'t','pageType':'column','tagId':'列表','editType':'null','pageId':'1229166692'}"></script>`;

describe('公开动态栏目协议', () => {
  it.each(['ningbo', 'yinzhou'] as const)(
    '%s 真实官网首页接口快照及SHA256回放',
    (kind) => {
      const dir = path.resolve(
        process.cwd(),
        '../tests/fixtures/golden-sources',
        kind,
      );
      const manifest = JSON.parse(
        readFileSync(path.join(dir, 'public-manifest.json'), 'utf8'),
      ) as {
        files: { name: string; url: string; sha256: string }[];
        stableMonitoringVerified: boolean;
      };
      const bodies = manifest.files.map((file) => {
        const bytes = readFileSync(path.join(dir, file.name));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          file.sha256,
        );
        return bytes.toString('utf8');
      });
      expect(publicColumnRequest(manifest.files[0].url, bodies[0])).toBe(
        manifest.files[1].url,
      );
      const items = discoverPublicColumn(
        manifest.files[1].url,
        bodies[1],
        kind,
      );
      expect(items.length).toBeGreaterThan(5);
      expect(
        items.some((item) => item.title.includes('公开招聘事业编制教师')),
      ).toBe(true);
      expect(manifest.stableMonitoringVerified).toBe(false);
    },
  );
  it.each([
    ['ningbo', 2],
    ['yinzhou', 3],
  ] as const)('%s 真实正文和附件下载链接回放', (kind, count) => {
    const dir = path.resolve(
      process.cwd(),
      '../tests/fixtures/golden-sources',
      kind,
    );
    const manifest = JSON.parse(
      readFileSync(path.join(dir, 'public-detail-manifest.json'), 'utf8'),
    ) as { files: { name: string; url: string; sha256: string }[] };
    const file = manifest.files[0];
    const bytes = readFileSync(path.join(dir, file.name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    const article = locatePublicArticle(file.url, bytes.toString('utf8'))!;
    expect(article.title).toContain('公开招聘事业编制教师');
    expect(article.bodyText).toContain('报名');
    expect(article.attachments).toHaveLength(count);
    expect(article.attachments[0].url).toContain(
      '/api-gateway/jpaas-web-server/front/document/download?',
    );
    expect(article.attachments[0].name).toMatch(/岗位/);
  });

  it('分页按官方参数扩展且超预算明确失败，不递归重复扩页', () => {
    const response = JSON.stringify({
      success: true,
      data: {
        html: '<table class="pagination" querydata="{}" rows="15" count="34" pageNo="1"></table>',
      },
    });
    const pages = publicColumnPages(base, response);
    expect(pages).toHaveLength(2);
    expect(
      JSON.parse(new URL(pages[0]).searchParams.get('paramJson')!),
    ).toEqual({ pageNo: 2, pageSize: '15' });
    expect(() => publicColumnPages(pages[0], response)).toThrow(/不一致/);
    expect(
      publicColumnPages(
        pages[0],
        response.replace('pageNo=\\"1\\"', 'pageNo=\\"2\\"'),
      ),
    ).toEqual([]);
    expect(() => publicColumnPages(base, response, 2)).toThrow(/预算/);
    expect(() => publicColumnPages(base, response.replace('34', '-1'))).toThrow(
      /参数/,
    );
  });

  it('只读取声明参数，不执行脚本；静态页不需要第二次请求', () => {
    const url = new URL(publicColumnRequest(base, script)!);
    expect(url.origin).toBe(new URL(base).origin);
    expect(url.searchParams.get('tagId')).toBe('列表');
    expect(publicColumnRequest(base, '<ul></ul>')).toBeNull();
  });
  it('拒绝跨域接口、未知路径、坏参数与失败返回', () => {
    expect(() =>
      publicColumnRequest(
        base,
        script.replace('url="/', 'url="https://evil.example/'),
      ),
    ).toThrow(/同源/);
    expect(() =>
      publicColumnRequest(
        base,
        script.replace('/front/page/build/unit', '/front/unknown'),
      ),
    ).toThrow(/路径/);
    expect(() =>
      publicColumnRequest(base, script.replace("'3505'", 'null')),
    ).toThrow(/webId/);
    expect(() => publicColumnHtml('{"success":false}')).toThrow(/data.html/);
  });
  it('宁波列表保留完整 title 属性及业务 URL', () => {
    const content = JSON.stringify({
      success: true,
      data: {
        html: '<div class="page-content"><table><tr><td class="car_tl"><a href="/a.html?item=1" title="教师招聘完整标题">教师...</a></td><td class="car_time">2026-07-09</td></tr></table></div>',
      },
    });
    expect(discoverPublicColumn(base, content, 'ningbo')).toEqual([
      {
        title: '教师招聘完整标题',
        publishedAt: '2026-07-09',
        url: 'https://jyj.ningbo.gov.cn/a.html?item=1',
        kind: 'announcement',
      },
    ]);
  });
  it('鄞州 li 列表保留取消公告且空结果显式失败', () => {
    const content = JSON.stringify({
      success: true,
      data: {
        html: '<div class="page-content"><li><a href="/a.html" title="取消教师招聘公告">取消...</a><span>2026-07-31</span></li></div>',
      },
    });
    expect(
      discoverPublicColumn(
        'https://www.nbyz.gov.cn/col/list.html',
        content,
        'yinzhou',
      )[0].kind,
    ).toBe('cancel');
    expect(() =>
      discoverPublicColumn(
        base,
        JSON.stringify({ success: true, data: { html: '<div></div>' } }),
        'ningbo',
      ),
    ).toThrow(/空列表/);
  });
});
