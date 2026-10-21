/**
 * v7.2 工作包 4：下载处理器（document.fetch）测试。
 *
 * 覆盖：304 不建快照、相同哈希幂等复用（不重复解析）、新内容建快照并投递解析、
 * 公告页发现附件、429 + Retry-After 退避后成功、持续 429 失败不覆盖旧数据、
 * 正文页 DOM 失配记结构变化、Worker 崩溃后重放同一任务幂等。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import { HangzhouEducationAdapter } from '../adapters/hangzhou-education.adapter.js';
import { NingboEducationAdapter } from '../adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from '../adapters/yinzhou-government.adapter.js';
import { NanjingEducationAdapter } from '../adapters/nanjing-education.adapter.js';
import { DocumentFetchService } from './document-fetch.service.js';
import type { DocumentFetchPayload } from './task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakeObjectStore,
  FakePrisma,
  OfflineFetcherFactory,
  readGolden,
  type OfflineResponder,
  type OfflineRoute,
} from '../testing/crawl-testing.js';

const LIST_URL = 'https://edu.hangzhou.gov.cn/col/col123/index.html';
const DETAIL_URL =
  'https://edu.hangzhou.gov.cn/art/2026/10/9/art_1229391906_59012345.html';
const ATTACHMENT_URL =
  'https://edu.hangzhou.gov.cn/art/2026/10/9/attach/0/bfd12345abcd.xlsx';
const SOURCE_ID = 'src-hz';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function setup(
  routes: OfflineRoute,
  options: {
    sourceOverrides?: Record<string, unknown>;
    responder?: OfflineResponder;
    prepare?: (prisma: FakePrisma) => void;
  } = {},
) {
  const prisma = new FakePrisma();
  prisma.seedSource({
    id: SOURCE_ID,
    publisher: '杭州市教育局',
    officialUrl: LIST_URL,
    adapterKey: 'hangzhou-education',
    allowedHosts: ['edu.hangzhou.gov.cn'],
    ...options.sourceOverrides,
  });
  options.prepare?.(prisma);
  const queue = new FakeCrawlTaskQueue();
  const objectStore = new FakeObjectStore();
  const runStore = new CrawlRunStore(prisma as never);
  const documentStore = new SourceDocumentStore(prisma as never);
  const factory = new OfflineFetcherFactory(routes, {}, [], options.responder);
  const registry = new AdapterRegistry(
    new HangzhouEducationAdapter(),
    new NingboEducationAdapter(),
    new YinzhouGovernmentAdapter(),
    new NanjingEducationAdapter(),
  );
  const service = new DocumentFetchService(
    runStore,
    documentStore,
    objectStore,
    factory,
    registry,
    queue,
  );
  const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'schedule' });
  const payload: DocumentFetchPayload = {
    sourceId: SOURCE_ID,
    runId: run.id,
    canonicalUrl: DETAIL_URL,
    kind: 'announcement',
  };
  return { prisma, queue, objectStore, factory, service, payload };
}

describe('DocumentFetchService.handle', () => {
  it('304：视为未变化，不创建快照、不写对象存储', async () => {
    const { prisma, objectStore, service, payload } = await setup({
      [DETAIL_URL]: { status: 304 },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('unchanged');
    expect(prisma.snapshots).toHaveLength(0);
    expect(objectStore.writes).toHaveLength(0);
    expect(prisma.findRun(payload.runId)!.unchangedCount).toBe(1);
  });

  it('相同内容哈希：复用已有快照，不重复解析（不投递 document.parse）', async () => {
    const detail = readGolden('hangzhou', 'detail.html');
    const hash = sha256(detail);
    const { prisma, queue, objectStore, service, payload } = await setup(
      { [DETAIL_URL]: detail },
      {
        prepare: (p) => {
          p.seedSnapshot({ sourceId: SOURCE_ID, contentHash: hash });
        },
      },
    );

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('unchanged');
    expect(prisma.snapshots).toHaveLength(1);
    expect(objectStore.writes).toHaveLength(0);
    expect(queue.count('document.parse')).toBe(0);
    expect(prisma.findRun(payload.runId)!.unchangedCount).toBe(1);
  });

  it('新内容：建快照、绑定文档、投递解析，并发现附件并投递附件下载', async () => {
    const { prisma, queue, objectStore, service, payload } = await setup({
      [DETAIL_URL]: readGolden('hangzhou', 'detail.html'),
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('downloaded');
    expect(prisma.snapshots).toHaveLength(1);
    expect(objectStore.writes).toHaveLength(1);
    expect(queue.count('document.parse')).toBe(1);

    const attachmentJob = queue.enqueued.find((job) => job.name === 'document.fetch');
    expect(attachmentJob).toBeDefined();
    const attachmentPayload = queue.jobs.get(attachmentJob!.jobId)!
      .payload as DocumentFetchPayload;
    expect(attachmentPayload.canonicalUrl).toBe(ATTACHMENT_URL);
    expect(attachmentPayload.kind).toBe('attachment');

    const attachmentDoc = prisma.documents.find((d) => d.canonicalUrl === ATTACHMENT_URL);
    expect(attachmentDoc).toBeDefined();
    expect(attachmentDoc!.kind).toBe('attachment');
    expect(prisma.findRun(payload.runId)!.downloadedCount).toBe(1);
  });

  it('429 带 Retry-After：退避后重试成功（真正重试而非放弃）', async () => {
    const detail = readGolden('hangzhou', 'detail.html');
    const { prisma, factory, service, payload } = await setup({}, {
      responder: (_url, index) =>
        index === 0
          ? new Response('slow down', {
              status: 429,
              headers: { 'retry-after': '1', 'content-type': 'text/html' },
            })
          : new Response(detail, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('downloaded');
    expect(prisma.snapshots).toHaveLength(1);
    // 第一次 429，第二次 200：证明按 Retry-After 退避重试
    expect(factory.calls).toHaveLength(2);
  });

  it('持续 429：失败计入 failed，已存在的旧快照不被覆盖', async () => {
    const { prisma, service, payload } = await setup({}, {
      responder: () =>
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '1', 'content-type': 'text/html' },
        }),
      prepare: (p) => {
        const snapshot = p.seedSnapshot({ sourceId: SOURCE_ID, contentHash: 'old-hash' });
        p.seedDocument({
          sourceId: SOURCE_ID,
          canonicalUrl: DETAIL_URL,
          latestSnapshotId: snapshot.id,
          contentHash: 'old-hash',
        });
      },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('failed');
    expect(prisma.snapshots).toHaveLength(1);
    expect(prisma.snapshots[0].contentHash).toBe('old-hash');
    expect(prisma.documents[0].latestSnapshotId).toBe('snap-1');
    expect(prisma.findRun(payload.runId)!.failedCount).toBe(1);
  });

  it('正文页 DOM 失配：记 structure_changed，不误报 downloaded', async () => {
    const broken = readGolden('hangzhou', 'detail.html').replace(
      /<div[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>[\s\S]*?<\/div>/i,
      '',
    );
    const { prisma, service, payload } = await setup({ [DETAIL_URL]: broken });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('structure_changed');
    expect(prisma.sources[0].healthStatus).toBe('structure_changed');
  });

  it('Worker 崩溃后重放同一任务：幂等，不重复建快照与解析任务', async () => {
    const { prisma, queue, objectStore, service, payload } = await setup({
      [DETAIL_URL]: readGolden('hangzhou', 'detail.html'),
    });

    const first = await service.handle(payload);
    const replay = await service.handle(payload);

    expect(first.status).toBe('downloaded');
    expect(replay.status).toBe('unchanged');
    expect(prisma.snapshots).toHaveLength(1);
    expect(objectStore.writes).toHaveLength(1);
    expect(queue.count('document.parse')).toBe(1);
  });

  it('HTTP 401（需登录）：转人工，来源标 blocked，不建快照', async () => {
    const { prisma, objectStore, service, payload } = await setup({
      [DETAIL_URL]: { status: 401, body: 'login required' },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('blocked');
    expect(prisma.sources[0].healthStatus).toBe('blocked');
    expect(prisma.snapshots).toHaveLength(0);
    expect(objectStore.writes).toHaveLength(0);
  });
});
