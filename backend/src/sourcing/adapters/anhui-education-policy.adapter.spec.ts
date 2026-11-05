import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnhuiEducationPolicyAdapter } from './anhui-education-policy.adapter.js';

const fixtureDir = resolve(
  process.cwd(),
  '../tests/fixtures/golden-sources/anhui-policy',
);
const listHtml = readFileSync(resolve(fixtureDir, 'public-shell.html'), 'utf8');
const detailHtml = readFileSync(resolve(fixtureDir, 'public-detail.html'), 'utf8');
const recruitHtml = readFileSync(
  resolve(fixtureDir, 'public-detail-recruit.html'),
  'utf8',
);

describe('AnhuiEducationPolicyAdapter（W5 首批政策扩源）', () => {
  const adapter = new AnhuiEducationPolicyAdapter();

  it('从真实首屏发现通知公告，且不静默返回空列表', () => {
    const items = adapter.discover({
      url: 'https://jyt.ah.gov.cn/xwzx/tzgg/index.html',
      mimeType: 'text/html',
      content: listHtml,
      fetchedAt: '2026-11-05T08:50:29.419Z',
    });

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.url.includes('/xwzx/tzgg/'))).toBe(true);
    expect(items.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt))).toBe(true);
    expect(items[0]!.title.length).toBeGreaterThan(0);
  });

  it('从真实正文页定位标题、日期、正文与附件链接', () => {
    const article = adapter.locateArticle({
      url: 'https://jyt.ah.gov.cn/xwzx/tzgg/40804849.html',
      mimeType: 'text/html',
      content: detailHtml,
      fetchedAt: '2026-11-05T08:50:29.419Z',
    });

    expect(article.canonicalUrl).toContain('/xwzx/tzgg/40804849.html');
    expect(article.title.length).toBeGreaterThan(4);
    expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.bodyText.length).toBeGreaterThan(50);
    expect(article.bodyText).not.toContain('<');
    expect(Array.isArray(article.attachments)).toBe(true);
  });

  it('解析真实教师招聘公告正文，保留标题/日期/正文供入库验收', () => {
    const article = adapter.locateArticle({
      url: 'https://jyt.ah.gov.cn/xwzx/tzgg/40792015.html',
      mimeType: 'text/html',
      content: recruitHtml,
      fetchedAt: '2026-11-05T09:40:00.000Z',
    });

    expect(article.canonicalUrl).toContain('/xwzx/tzgg/40792015.html');
    expect(article.title).toContain('特设岗位计划招聘公告');
    expect(article.publishedAt).toBe('2026-06-02');
    expect(article.bodyText.length).toBeGreaterThan(500);
    expect(article.bodyText).not.toContain('<');
    expect(article.bodyText).toContain('招聘');
  });
});
