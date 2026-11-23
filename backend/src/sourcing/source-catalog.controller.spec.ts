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
    {} as never, // SnapshotRetentionService（保留策略，本用例不触达）
  );
  return { controller, upsertSource };
}

describe('S5 来源目录接口', () => {
  it('目录返回候选和可登记配置，读取不写入数据库', () => {
    const { controller, upsertSource } = setup();
    const result = controller.catalog();
    expect(result.entries).toHaveLength(34);
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
    // 22 个 ready 来源已完成两次真实检查，连续成功达到阈值，状态为 monitoring；
    // 郑州、福州、广州、石家庄、武汉、长沙、贵阳为 N3 新增，只有 1 次首次采样成功，
    // 处于 verifying（一次成功未达阈值）；
    // 北京、重庆为 N4 新增，尚未登记真实运行，仍为 unverified；
    // candidate 2 + blocked 1 = 3，再加 N4 2 个 = 5。
    const states = result.entries.map((entry) => entry.monitoring.state);
    expect(states.filter((state) => state === 'monitoring')).toHaveLength(22);
    expect(states.filter((state) => state === 'verifying')).toHaveLength(7);
    expect(states.filter((state) => state === 'unverified')).toHaveLength(5);
  });

  it('seed 只投入已核验来源，不含候选与 blocked 项', async () => {
    const { controller, upsertSource } = setup();
    const result = await controller.seed();
    expect(result.count).toBe(31);
    expect(upsertSource).toHaveBeenCalledTimes(31);
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
      'huzhou-education',
      'taizhou-education',
      'bozhou-education',
      'fuyang-education',
      'jinan-education',
      'yantai-education',
      'taian-education',
      'weifang-education',
      'nanchang-education',
      'taiyuan-education',
      'zhengzhou-education',
      'fuzhou-education',
      'guangzhou-education',
      'shijiazhuang-education',
      'wuhan-education',
      'changsha-education',
      'guiyang-education',
      'changzhou-education',
      'lishui-education',
      'bengbu-education',
      'xiaoshan-education',
      'beijing-rsj-recruitment',
      'chongqing-rsj-recruitment',
      'anhui-education-policy',
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
