import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManualExtractionService } from './manual-extraction.service.js';
import { DocumentParserService } from '../document-processing/document-parser.service.js';
import { DocumentParseStore } from '../document-processing/document-parse-store.js';
import { FakeObjectStore, FakePrisma } from '../sourcing/testing/crawl-testing.js';
import type { ExtractionCandidate } from './domain.js';

const root = path.resolve(process.cwd(), '../tests/fixtures/golden-sources/ningbo');
const outside = 'C:/Users/cchen/AppData/Local/Temp/wb-cap/s5-task4';

describe('S5 真实附件提取探测', () => {
  it('宁波 xlsx 与南京 xls 能进入材料包', async () => {
    const prisma = new FakePrisma();
    const service = new ManualExtractionService(
      prisma as never,
      new DocumentParserService(),
      new DocumentParseStore(prisma as never),
      new FakeObjectStore(),
    );
    const submitted = await service.submitSource(
      {
        publisher: '宁波市教育局',
        officialUrl:
          'https://jyj.ningbo.gov.cn/col/col1229166692/art/2026/art_c58c701a5e034741ab977dfe7f771545.html',
        regionCode: '330200',
        sourceType: 'manual_text',
        content: readFileSync(path.join(root, 'public-detail.html'), 'utf8'),
        mimeType: 'text/html',
        attachments: [
          {
            name: '招聘单位岗位学历专业及资格条件表.xlsx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            bytes: readFileSync(path.join(outside, 'ningbo-att-1.bin')),
          },
          {
            name: '南京核减计划情况表.xls',
            mimeType: 'application/vnd.ms-excel',
            bytes: readFileSync(path.join(outside, 'nanjing-correction-1.xls')),
          },
        ],
      },
      's5-task4-probe',
    );
    const run = submitted.run as { id: string };
    const outcome = await service.runExtraction(run.id);
    const saved = prisma.extractionRuns.find((row) => row.id === run.id)!;
    const candidate = saved.candidate as ExtractionCandidate;
    console.log(
      JSON.stringify(
        {
          status: outcome.status,
          files: outcome.files,
          fieldCount: candidate.fields.length,
          statuses: candidate.fields.reduce<Record<string, number>>((acc, field) => {
            const key = field.status ?? 'extracted';
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
          sample: candidate.fields.slice(0, 12).map((field) => ({
            field: field.field,
            value: field.value.slice(0, 40),
            status: field.status,
            job: field.jobScope?.key,
          })),
        },
        null,
        2,
      ),
    );
    expect(outcome.files).toHaveLength(3);
  }, 30000);
});
