/**
 * 试跑预算：服务端校验与内存实现口径。
 *
 * 重点不是“能配多少”，而是“超限会被拒绝、重复不重复扣、停止后不再放行”。
 */
import { describe, expect, it } from 'vitest';
import {
  TRIAL_BUDGET_DEFAULTS,
  TRIAL_BUDGET_HARD_CAPS,
  TrialBudgetValidationError,
  resolveTrialBudget,
} from './crawl-budget.js';
import { InMemoryCrawlBudgetStore } from './testing/crawl-testing.js';

const RUN = 'run-budget-test';

describe('resolveTrialBudget', () => {
  it('缺省使用首轮建议值：1 页 / 3 详情 / 每篇 2 附件 / 整轮 6 附件 / 20 请求', () => {
    expect(resolveTrialBudget()).toEqual(TRIAL_BUDGET_DEFAULTS);
  });

  it('拒绝超过服务端硬上限的值', () => {
    expect(() =>
      resolveTrialBudget({ maxListPages: TRIAL_BUDGET_HARD_CAPS.maxListPages + 1 }),
    ).toThrow(TrialBudgetValidationError);
    expect(() =>
      resolveTrialBudget({ maxDetails: TRIAL_BUDGET_HARD_CAPS.maxDetails + 1 }),
    ).toThrow(TrialBudgetValidationError);
  });

  it('拒绝每篇附件额度大于整轮额度', () => {
    expect(() =>
      resolveTrialBudget({
        maxAttachmentsPerDocument: 5,
        maxAttachmentsTotal: 3,
      }),
    ).toThrow(/不能大于/);
  });

  it('拒绝无法覆盖一次完整执行的请求预算', () => {
    expect(() =>
      resolveTrialBudget({
        maxListPages: 1,
        maxDetails: 3,
        maxAttachmentsTotal: 6,
        maxHttpRequests: 9,
      }),
    ).toThrow(/至少要覆盖/);
  });

  it('拒绝非整数与 0', () => {
    expect(() => resolveTrialBudget({ maxDetails: 1.5 })).toThrow(
      TrialBudgetValidationError,
    );
    expect(() => resolveTrialBudget({ maxDetails: 0 })).toThrow(
      TrialBudgetValidationError,
    );
  });
});

describe('InMemoryCrawlBudgetStore', () => {
  it('准入按 URL 幂等：重投/重放不重复占用详情与附件额度', async () => {
    const store = new InMemoryCrawlBudgetStore();
    await store.create(RUN, 'src', TRIAL_BUDGET_DEFAULTS);

    expect(await store.admitDocument(RUN, 'https://a/1.html')).toBe('admitted');
    expect(await store.admitDocument(RUN, 'https://a/1.html')).toBe('duplicate');
    expect((await store.get(RUN))!.detailsUsed).toBe(1);

    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/1.pdf')).toBe(
      'admitted',
    );
    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/1.pdf')).toBe(
      'duplicate',
    );
    expect((await store.get(RUN))!.attachmentsUsed).toBe(1);
  });

  it('附件同时受每篇与整轮额度约束，被拒不计入已用但记入未覆盖', async () => {
    const store = new InMemoryCrawlBudgetStore();
    await store.create(RUN, 'src', {
      ...TRIAL_BUDGET_DEFAULTS,
      maxAttachmentsPerDocument: 2,
      maxAttachmentsTotal: 3,
    });

    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/1.pdf')).toBe(
      'admitted',
    );
    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/2.pdf')).toBe(
      'admitted',
    );
    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/3.pdf')).toBe(
      'exhausted',
    );
    // 另一篇仍有整轮余额（1 个），用完后整轮耗尽
    expect(await store.admitAttachment(RUN, 'doc-2', 'https://a/4.pdf')).toBe(
      'admitted',
    );
    expect(await store.admitAttachment(RUN, 'doc-2', 'https://a/5.pdf')).toBe(
      'exhausted',
    );

    const snapshot = (await store.get(RUN))!;
    expect(snapshot.attachmentsUsed).toBe(3);
    expect(snapshot.attachmentsDeferred).toBe(2);
    expect(snapshot.remaining.attachments).toBe(0);
  });

  it('停止后所有入口都拒绝：列表、详情、附件、HTTP 请求', async () => {
    const store = new InMemoryCrawlBudgetStore();
    await store.create(RUN, 'src', TRIAL_BUDGET_DEFAULTS);
    await store.admitDocument(RUN, 'https://a/1.html');

    await store.stop(RUN, 'stopped_by_admin');

    expect(await store.consumeListPage(RUN)).toBe('stopped');
    expect(await store.admitDocument(RUN, 'https://a/2.html')).toBe('stopped');
    expect(await store.admitAttachment(RUN, 'doc-1', 'https://a/1.pdf')).toBe(
      'stopped',
    );
    expect(await store.consumeHttpAttempt(RUN)).toBe('stopped');
    expect(await store.isStopped(RUN)).toBe(true);
  });

  it('HTTP 请求预算按次数扣减，耗尽后不再放行（重试同样计入）', async () => {
    const store = new InMemoryCrawlBudgetStore();
    await store.create(RUN, 'src', {
      ...TRIAL_BUDGET_DEFAULTS,
      maxHttpRequests: 10,
    });

    for (let i = 0; i < 10; i += 1) {
      expect(await store.consumeHttpAttempt(RUN)).toBe('ok');
    }
    expect(await store.consumeHttpAttempt(RUN)).toBe('exhausted');
    const snapshot = (await store.get(RUN))!;
    expect(snapshot.httpRequestsUsed).toBe(10);
    expect(snapshot.remaining.httpRequests).toBe(0);
  });

  it('没有预算行的运行不受影响（常规调度）', async () => {
    const store = new InMemoryCrawlBudgetStore();
    expect(await store.get('run-without-budget')).toBeNull();
    expect(await store.consumeListPage('run-without-budget')).toBe('unbudgeted');
    expect(await store.admitDocument('run-without-budget', 'https://a')).toBe(
      'unbudgeted',
    );
    expect(await store.isAdmitted('run-without-budget', 'document', 'https://a')).toBe(
      'unbudgeted',
    );
    expect(await store.consumeHttpAttempt('run-without-budget')).toBe(
      'unbudgeted',
    );
    expect(await store.isStopped('run-without-budget')).toBe(false);
  });
});
