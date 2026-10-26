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
  );
  return { controller, upsertSource };
}

describe('S5 来源目录接口', () => {
  it('目录返回候选和可登记配置，读取不写入数据库', () => {
    const { controller, upsertSource } = setup();
    const result = controller.catalog();
    expect(result.entries).toHaveLength(13);
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
    // 首批 9 个来源只完成一次真实采样，状态停在 verifying。
    const states = result.entries.map((entry) => entry.monitoring.state);
    expect(states.filter((state) => state === 'verifying')).toHaveLength(9);
    expect(states).not.toContain('monitoring');
  });

  it('seed 只投入已核验来源，不含候选与 blocked 项', async () => {
    const { controller, upsertSource } = setup();
    const result = await controller.seed();
    expect(result.count).toBe(9);
    expect(upsertSource).toHaveBeenCalledTimes(9);
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
