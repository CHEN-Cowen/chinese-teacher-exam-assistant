import { describe, expect, it } from 'vitest';
import {
  SOURCE_CATALOG,
  SOURCE_MONITORING_RECORDS,
  appendSourceCheck,
  getCatalogSourceKeys,
  getSeedableSources,
  getSourceMonitoringRecord,
  validateSourceCatalog,
} from './source-catalog.js';
import {
  canClaimMonitoring,
  summarizeMonitoring,
} from './source-monitoring.js';

describe('S5 来源目录', () => {
  it('保留 10-20 个候选来源，并区分省级、市级和区县级', () => {
    expect(SOURCE_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(SOURCE_CATALOG.length).toBeLessThanOrEqual(20);
    expect(
      new Set(SOURCE_CATALOG.map((entry) => entry.authorityLevel)),
    ).toEqual(new Set(['province', 'city', 'district']));
    expect(validateSourceCatalog()).toEqual([]);
  });

  it('只有完成入口、适配器、样本和人工核验的来源才能进入 seed', () => {
    const seedable = getSeedableSources();
    // S5 真实核验通过：南京、宁波、鄞州、杭州、绍兴、嘉兴、苏州、常州、丽水
    expect(seedable.map((source) => source.adapterKey)).toEqual([
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
      SOURCE_CATALOG.filter((entry) => entry.status === 'candidate'),
    ).toHaveLength(2);
    expect(
      SOURCE_CATALOG.filter((entry) => entry.status === 'blocked'),
    ).toHaveLength(2);
  });

  it('禁止把目录外域名或非 HTTPS 链接投入 seed', () => {
    const invalid = SOURCE_CATALOG.map((entry) =>
      entry.sourceKey === 'nanjing-education'
        ? { ...entry, listUrls: ['https://untrusted.example/list'] }
        : entry,
    );
    expect(() => getSeedableSources(invalid)).toThrow(/白名单/);
  });

  it('忽略不存在核验日期的候选，即使它已有适配器', () => {
    // 杭州已在 2026-10-26 完成真实核验并进入 seed；
    // 此处构造“已有适配器与栏目入口、但缺核验资料”的市级候选，
    // 确认它仍然被挡在 seed 之外（候选不得因为“配置齐全”就被自动启用）。
    const invalid = SOURCE_CATALOG.map((entry) =>
      entry.sourceKey === 'wuxi-education-candidate'
        ? {
            ...entry,
            status: 'candidate' as const,
            adapterKey: 'wuxi-education',
            listUrls: ['https://jyj.wuxi.gov.cn/col/col123/index.html'],
            verifiedAt: null,
            sampleRef: null,
          }
        : entry,
    );
    expect(validateSourceCatalog(invalid)).toEqual([]);
    expect(
      getSeedableSources(invalid).some(
        (entry) => entry.adapterKey === 'wuxi-education',
      ),
    ).toBe(false);
    expect(
      SOURCE_CATALOG.find((entry) => entry.sourceKey === 'hangzhou-education')
        ?.status,
    ).toBe('ready');
  });

  it('blocked 来源不得进入 seed', () => {
    const blocked = SOURCE_CATALOG.filter(
      (entry) => entry.status === 'blocked',
    );
    expect(blocked.length).toBeGreaterThan(0);
    for (const entry of blocked) {
      expect(
        getSeedableSources().some(
          (source) => source.adapterKey === entry.adapterKey,
        ),
      ).toBe(false);
    }
  });

  it('拒绝把未核验候选伪装成 ready', () => {
    const invalid = SOURCE_CATALOG.map((entry) =>
      entry.sourceKey === 'jiangsu-education-candidate'
        ? { ...entry, status: 'ready' as const }
        : entry,
    );
    expect(validateSourceCatalog(invalid)).toContain(
      'ready 来源缺少核验资料: jiangsu-education-candidate',
    );
  });

  it('行政级别按来源显式登记，不从地区代码后缀推导', () => {
    // 320000=江苏省级、320100=南京市级、320200=无锡市级、330212=宁波鄞州区级。
    // 若按 endsWith('00') 推导，省级会被误判为市级、地级市会被误判为区县级。
    const levelOf = (key: string) =>
      SOURCE_CATALOG.find((entry) => entry.sourceKey === key)?.authorityLevel;
    expect(levelOf('jiangsu-education-candidate')).toBe('province');
    expect(levelOf('zhejiang-education-candidate')).toBe('province');
    expect(levelOf('nanjing-education')).toBe('city');
    expect(levelOf('ningbo-education')).toBe('city');
    expect(levelOf('hangzhou-education')).toBe('city');
    expect(levelOf('shaoxing-education')).toBe('city');
    expect(levelOf('jiaxing-education')).toBe('city');
    expect(levelOf('suzhou-education')).toBe('city');
    expect(levelOf('lishui-education')).toBe('city');
    expect(levelOf('yinzhou-government')).toBe('district');
  });

  it('省级来源不得登记栏目列表，避免用省级来源冒充市县覆盖', () => {
    const invalid = SOURCE_CATALOG.map((entry) =>
      entry.sourceKey === 'jiangsu-education-candidate'
        ? {
            ...entry,
            listUrls: ['https://jyt.jiangsu.gov.cn/col/col123/index.html'],
          }
        : entry,
    );
    expect(validateSourceCatalog(invalid)).toContain(
      '省级来源不得登记栏目列表: jiangsu-education-candidate',
    );
  });

  it('核验日期按各来源真实抓取时间记录，不统一为同一天', () => {
    const verifiedAtOf = (key: string) =>
      SOURCE_CATALOG.find((entry) => entry.sourceKey === key)?.verifiedAt;
    // 南京样本核验于 2026-10-21，宁波/鄞州公开接口核验于 2026-10-24，
    // 杭州/绍兴/嘉兴/苏州/常州/丽水核验于 2026-10-26。
    expect(verifiedAtOf('nanjing-education')).toBe('2026-10-21');
    expect(verifiedAtOf('ningbo-education')).toBe('2026-10-24');
    expect(verifiedAtOf('yinzhou-government')).toBe('2026-10-24');
    expect(verifiedAtOf('hangzhou-education')).toBe('2026-10-26');
    expect(verifiedAtOf('shaoxing-education')).toBe('2026-10-26');
    expect(verifiedAtOf('jiaxing-education')).toBe('2026-10-26');
    expect(verifiedAtOf('suzhou-education')).toBe('2026-10-26');
    expect(verifiedAtOf('changzhou-education')).toBe('2026-10-26');
    expect(verifiedAtOf('lishui-education')).toBe('2026-10-26');
  });
});

describe('S5 来源级检查记录与监测状态', () => {
  it('ready 来源必须登记检查记录，没有记录就不是「在监测」', () => {
    const ready = SOURCE_CATALOG.filter((entry) => entry.status === 'ready');
    expect(ready.length).toBe(9);
    for (const entry of ready) {
      const record = getSourceMonitoringRecord(entry.sourceKey);
      expect(
        record.checks.length,
        `${entry.sourceKey} 缺少来源级检查记录`,
      ).toBeGreaterThan(0);
    }
  });

  it('首批来源只完成一次真实采样，尚不能声称正常监测', () => {
    // S0 规范：“正常监测”必须有来源级检查记录，不能仅凭存在适配器判断。
    // 9 个来源都只做过首次真实采样，连续成功次数未达阈值，
    // 因此状态只能是 verifying，不得对外声称 monitoring。
    for (const record of SOURCE_MONITORING_RECORDS) {
      const summary = summarizeMonitoring(record);
      expect(summary.state, record.sourceKey).toBe('verifying');
      expect(canClaimMonitoring(summary), record.sourceKey).toBe(false);
    }
  });

  it('candidate 与 blocked 来源没有检查记录，状态为 unverified', () => {
    const notReady = SOURCE_CATALOG.filter((entry) => entry.status !== 'ready');
    expect(notReady.length).toBeGreaterThan(0);
    for (const entry of notReady) {
      const summary = summarizeMonitoring(
        getSourceMonitoringRecord(entry.sourceKey),
      );
      expect(summary.state, entry.sourceKey).toBe('unverified');
      expect(canClaimMonitoring(summary), entry.sourceKey).toBe(false);
    }
  });

  it('检查记录的时间戳与各来源真实抓取时间一致', () => {
    const checkedAtOf = (key: string) =>
      getSourceMonitoringRecord(key).checks[0]?.checkedAt;
    expect(checkedAtOf('nanjing-education')).toBe('2026-10-21T00:00:00.000Z');
    expect(checkedAtOf('hangzhou-education')).toBe('2026-10-26T03:29:35.478Z');
    expect(checkedAtOf('ningbo-education')).toBe('2026-10-24T14:14:37.873Z');
    expect(checkedAtOf('yinzhou-government')).toBe('2026-10-24T14:14:37.901Z');
    expect(checkedAtOf('shaoxing-education')).toBe('2026-10-26T02:09:31.002Z');
    expect(checkedAtOf('jiaxing-education')).toBe('2026-10-26T02:09:32.033Z');
    expect(checkedAtOf('suzhou-education')).toBe('2026-10-26T02:09:32.869Z');
    expect(checkedAtOf('changzhou-education')).toBe('2026-10-26T02:47:27.596Z');
    expect(checkedAtOf('lishui-education')).toBe('2026-10-26T04:08:21.242Z');
  });

  it('补录第二次成功检查后，来源才可判定为正常监测', () => {
    const next = appendSourceCheck(
      SOURCE_MONITORING_RECORDS,
      'lishui-education',
      {
        checkedAt: '2026-10-26T05:00:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 2,
        contentHash: 'def456',
      },
    );
    const summary = summarizeMonitoring(
      getSourceMonitoringRecord('lishui-education', next),
    );
    expect(summary.state).toBe('monitoring');
    expect(summary.currentStreak).toBe(2);
    expect(canClaimMonitoring(summary)).toBe(true);
    // 原始记录不被修改（纯函数）。
    expect(getSourceMonitoringRecord('lishui-education').checks.length).toBe(1);
  });

  it('目录 sourceKey 列表覆盖全部登记来源', () => {
    const keys = getCatalogSourceKeys();
    expect(keys.length).toBe(SOURCE_CATALOG.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
