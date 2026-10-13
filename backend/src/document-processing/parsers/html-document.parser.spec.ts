/**
 * v7.2 附件解析：HTML 解析器测试（恶意节点剥离、选择器定位、嵌套去重、截断）。
 */
import { describe, expect, it } from 'vitest';
import { GuardError, readParseLimits } from '../parse-guard.js';
import { HtmlDocumentParser } from './html-document.parser.js';
import { MALICIOUS_HTML } from '../testing/fixture-builders.js';

const limits = readParseLimits({});
const parser = new HtmlDocumentParser(limits);

function input(html: string) {
  return {
    snapshotId: 'snap-html-1',
    sourceUrl: 'https://example.gov.cn/a.html',
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc',
    declaredMime: 'text/html',
    declaredExtension: 'html',
    bytes: Buffer.from(html, 'utf8'),
  };
}

describe('HtmlDocumentParser', () => {
  it('提取段落与标题：块带 selector + 文本片段 + 来源 URL', async () => {
    const html = '<html><head><title>2026年招聘公告</title></head><body><h1>杭州市招聘</h1><p>学历要求：本科及以上。</p></body></html>';
    const doc = await parser.parse(input(html));
    expect(doc.format).toBe('html');
    expect(doc.title).toBe('2026年招聘公告');
    expect(doc.blocks.length).toBe(2);
    const p = doc.blocks.find((b) => b.text.includes('本科'));
    expect(p?.locator.kind).toBe('html');
    if (p?.locator.kind === 'html') {
      expect(p.locator.selector).toContain('p');
      expect(p.locator.sourceUrl).toBe('https://example.gov.cn/a.html');
    }
  });

  it('恶意 HTML：script/iframe 被剥离且不执行，记录告警', async () => {
    const doc = await parser.parse(input(MALICIOUS_HTML));
    const allText = doc.blocks.map((b) => b.text).join('\n');
    expect(allText).not.toContain('alert');
    expect(allText).not.toContain('evil.example.com');
    expect(doc.warnings.some((w) => w.includes('script'))).toBe(true);
    expect(doc.warnings.some((w) => w.includes('iframe'))).toBe(true);
  });

  it('嵌套块不重复成块（外层吞掉内层）', async () => {
    const html = '<html><body><div><p>外层段落内容。</p></div></body></html>';
    const doc = await parser.parse(input(html));
    const matches = doc.blocks.filter((b) => b.text.includes('外层段落内容'));
    expect(matches).toHaveLength(1);
  });

  it('块数量超上限截断并告警', async () => {
    const tiny = new HtmlDocumentParser({ ...limits, maxBlocks: 1 });
    const html = '<html><body><p>第一段。</p><p>第二段。</p></body></html>';
    const doc = await tiny.parse(input(html));
    expect(doc.blocks).toHaveLength(1);
    expect(doc.warnings.some((w) => w.includes('上限'))).toBe(true);
  });

  it('空 HTML → 无块（不抛错，由上层判空）', async () => {
    await expect(parser.parse(input('<html><body></body></html>'))).resolves.toMatchObject({
      blocks: [],
    });
  });

  it('无魔数匹配的字节交给调度器判定（此处直接喂 HTML 正常解析）', async () => {
    await expect(parser.parse(input('<p>普通公告正文内容。</p>'))).resolves.toBeTruthy();
  });
});

describe('边界', () => {
  it('GuardError 可被识别（供服务层映射错误码）', () => {
    const error = new GuardError('UNKNOWN_FORMAT', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('UNKNOWN_FORMAT');
  });
});
