import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NanjingEducationAdapter } from './adapters/nanjing-education.adapter.js';
import { FakeObjectStore, FakePrisma } from './testing/crawl-testing.js';
import { ManualExtractionService } from '../announcements/manual-extraction.service.js';
import { DocumentParserService } from '../document-processing/document-parser.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import type { ExtractionCandidate } from '../announcements/domain.js';

const dir = path.resolve(process.cwd(), '../tests/fixtures/golden-sources/nanjing');
const url = 'https://edu.nanjing.gov.cn/bsfw/zpzk/202601/t20260109_5761685.html';

// 真实历史原件的离线回放；FakePrisma 不代表 PostgreSQL/Redis 或真实人工审核验收。
describe('S4 南京真实历史材料回放', () => {
  it('原始 HTML + 两份 PDF 进入既有材料包提取，保留文件状态与证据', async () => {
    const html = readFileSync(path.join(dir, 'detail.html'), 'utf8');
    const article = new NanjingEducationAdapter().locateArticle({ url, content: html, mimeType: 'text/html', fetchedAt: '2026-10-21T00:00:00Z' });
    expect(article.attachments).toHaveLength(4);
    const prisma = new FakePrisma();
    const service = new ManualExtractionService(prisma as never, new DocumentParserService(), new DocumentParseStore(prisma as never), new FakeObjectStore());
    const submitted = await service.submitSource({
      publisher: '南京市教育局', officialUrl: url, regionCode: '320100', sourceType: 'manual_text',
      content: html, mimeType: 'text/html',
      attachments: ['gw1.pdf', 'gw2.pdf'].map((name, index) => ({ name: article.attachments[index].name, mimeType: 'application/pdf', bytes: readFileSync(path.join(dir, name)) })),
    }, 's4-offline-test');
    const run = submitted.run as { id: string };
    const outcome = await service.runExtraction(run.id);
    expect(outcome.files).toHaveLength(3);
    expect(outcome.files.every((file) => file.readStatus === 'ok')).toBe(true);
    const candidate = prisma.extractionRuns.find((row) => row.id === run.id)!.candidate as ExtractionCandidate;
    expect(candidate.fields.length).toBeGreaterThan(0);
    expect(candidate.fields.some((field) => field.anchor)).toBe(true);
    expect(prisma.extractionRuns.find((row) => row.id === run.id)!.status).not.toBe('published');
    // 原文还有专业目录及承诺书，未纳入本次材料包，不能声称材料完整率100%。
    expect(article.attachments.length).toBeGreaterThan(outcome.files.length - 1);
  }, 30000);
});
