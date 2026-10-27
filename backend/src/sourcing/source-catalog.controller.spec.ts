import { describe, expect, it, vi } from 'vitest';
import { SourcingController } from './sourcing.controller.js';

function setup() {
  const upsertSource = vi.fn(async (source: unknown) => source);
  const controller = new SourcingController(
    {} as never,
    { upsertSource } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never, // CrawlHealthService（M02/F3 health 聚合，本用例不触达）
    {} as never, // SourcingAlertService
  );
  return { controller, upsertSource };
}

describe('S5 来源目录接口', () => {
  it('目录返回候选和可登记配置，读取不写入数据库', () => {
    const { controller, upsertSource } = setup();
    const result = controller.catalog();
    expect(result.entries).toHaveLength(15);
    expect(result.validationErrors).toEqual([]);
    expect(upsertSource).not.toHaveBeenCalled();
  });

  it('目录为每个来源附带监测状态，且不得声称已正常监测', () => {
    const { controller } = setup();
    const result = controller.catalog();
    for (const entry of result.entries) {
      expect(entry.monitoring).toBeTruthy();
      expect(entry.monitoring.sourceKey).toBe(entry.sourceKey);
    }
    // 11 个 ready 来源都已完成两次真实检查（第二次为 no_new 或 succeeded），
    // 连续成功达到阈值，状态为 monitoring；candidate/blocked 仍是 unverified。
    const states = result.entries.map((entry) => entry.monitoring.state);
    expect(states.filter((state) => state === 'monitoring')).toHaveLength(11);
    expect(states.filter((state) => state === 'verifying')).toHaveLength(0);
    expect(states.filter((state) => state === 'unverified')).toHaveLength(4);
  });

  it('seed 只投入已核验来源，不含候选与 blocked 项', async () => {
    const { controller, upsertSource } = setup();
    const result = await controller.seed();
    expect(result.count).toBe(11);
    expect(upsertSource).toHaveBeenCalledTimes(11);
    const seeded = upsertSource.mock.calls.map(
      (call) => call[0] as { adapterKey: string },
    );
    expect(seeded.map((entry) => entry.adapterKey)).toEqual([
      'nanjing-education',
      'hangzhou-education',
      'ningbo-education',
      'yinzhou-government',
      'shaoxing-education',
      'jiaxing-education',
      'suzhou-education',
      'changzhou-education',
      'lishui-education',
      'bengbu-education',
      'xiaoshan-education',
    ]);
    expect(
      seeded.some((entry) => entry.adapterKey === 'wuxi-education-candidate'),
    ).toBe(false);
    expect(
      seeded.some(
        (entry) => entry.adapterKey === 'zhejiang-education-candidate',
      ),
    ).toBe(false);
  });
});
