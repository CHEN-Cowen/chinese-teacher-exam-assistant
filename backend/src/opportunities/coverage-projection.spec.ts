/**
 * M01（F1/F2）：统一服务端覆盖投影测试。
 *
 * 覆盖点：
 * - 来源状态推导：registered / verified / recently_healthy / check_failed /
 *   paused / blocked，含新鲜窗口过期回落与运行时状态优先级；
 * - 省级状态推导：not_started / registered / verified / monitoring_no_open /
 *   open_batch_exists / paused；
 * - 口径字段：generatedAt、isFallback、fallbackNote、publishedOpenUnits；
 * - 真实台账集成：SOURCE_CATALOG + SOURCE_MONITORING_RECORDS 投影不抛错、
 *   计数一致、ready 来源在窗口内为 recently_healthy；
 * - 纯函数性质：同一输入重复构建结果一致。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCoverageProjection,
  COVERAGE_PROJECTION_VERSION,
  DEFAULT_FRESHNESS_WINDOW_HOURS,
  deriveProvinceStatus,
  getFreshnessWindowHours,
  type RuntimeSourceState,
} from './coverage-projection.js';
import type { SourceCatalogEntry } from '../sourcing/source-catalog.js';
import type { SourceMonitoringRecord } from '../sourcing/source-monitoring.js';
import { SOURCE_CATALOG, SOURCE_MONITORING_RECORDS } from '../sourcing/source-catalog.js';

const NOW = new Date('2026-10-26T10:00:00.000Z');

function catalogEntry(overrides: Partial<SourceCatalogEntry> = {}): SourceCatalogEntry {
  return {
    sourceKey: 'test-city-education',
    publisher: '测试市教育局',
    regionCode: '320100',
    authorityLevel: 'city',
    officialUrl: 'https://edu.nanjing.gov.cn/',
    listUrls: ['https://edu.nanjing.gov.cn/list'],
    allowedHosts: ['edu.nanjing.gov.cn'],
    adapterKey: 'test-city-education',
    status: 'ready',
    verifiedAt: '2026-10-21',
    sampleRef: 'tests/fixtures/golden-sources/test-city',
    coverageNote: '测试来源',
    ...overrides,
  };
}

function checkRecord(overrides: Partial<SourceMonitoringRecord['checks'][number]> = {}) {
  return {
    checkedAt: '2026-10-26T09:00:00.000Z',
    outcome: 'no_new' as const,
    discoveredCount: 10,
    contentHash: 'a'.repeat(64),
    note: null,
    ...overrides,
  };
}

function runtimeState(overrides: Partial<RuntimeSourceState> = {}): RuntimeSourceState {
  return {
    adapterKey: 'test-city-education',
    enabled: true,
    lastSuccessAt: new Date('2026-10-26T09:00:00.000Z'),
    lastCheckedAt: new Date('2026-10-26T09:00:00.000Z'),
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('buildCoverageProjection：来源状态推导', () => {
  it('ready 来源连续检查达标且在新鲜窗口内 → recently_healthy', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [
            checkRecord({ checkedAt: '2026-10-26T08:00:00.000Z' }),
            checkRecord({ checkedAt: '2026-10-26T09:00:00.000Z' }),
          ],
        },
      ],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources).toHaveLength(1);
    expect(projection.sources[0]!.state).toBe('recently_healthy');
    expect(projection.sources[0]!.lastCheckedAt).toBe('2026-10-26T09:00:00.000Z');
    expect(projection.caliber.recentlyHealthySources).toBe(1);
  });

  it('最近检查超过新鲜窗口 → verified（检查超时/待确认），不得声称近期正常', () => {
    const projection = buildCoverageProjection({
      // 最后检查 2026-10-24T09:00Z，距 now 49 小时 > 48 小时窗口
      now: new Date('2026-10-26T10:00:00.000Z'),
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [
            checkRecord({ checkedAt: '2026-10-23T09:00:00.000Z' }),
            checkRecord({ checkedAt: '2026-10-24T09:00:00.000Z' }),
          ],
        },
      ],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('verified');
    expect(projection.sources[0]!.note).toContain('新鲜窗口');
    expect(projection.caliber.recentlyHealthySources).toBe(0);
  });

  it('candidate 来源 → registered；blocked 来源 → blocked', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry({
          sourceKey: 'cand-1',
          adapterKey: null,
          status: 'candidate',
          verifiedAt: null,
          sampleRef: null,
          coverageNote: '待人工核验栏目与附件',
        }),
        catalogEntry({
          sourceKey: 'blocked-1',
          status: 'blocked',
          coverageNote: '入口不可用',
        }),
      ],
      monitoringRecords: [],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('registered');
    expect(projection.sources[1]!.state).toBe('blocked');
    expect(projection.caliber.registeredSources).toBe(2);
  });

  it('运行时 enabled=false 优先于台账检查记录 → paused', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [checkRecord(), checkRecord()],
        },
      ],
      runtimeSources: [runtimeState({ enabled: false })],
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('paused');
    expect(projection.caliber.pausedSources).toBe(1);
  });

  it('运行时连续失败且检查不早于台账 → check_failed', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [checkRecord()],
        },
      ],
      runtimeSources: [
        runtimeState({
          lastCheckedAt: new Date('2026-10-26T09:30:00.000Z'),
          consecutiveFailures: 3,
        }),
      ],
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('check_failed');
    expect(projection.sources[0]!.note).toContain('连续失败 3 次');
  });

  it('运行时失败但台账检查更新 → 以台账检查记录推导，不误报失败', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [
            checkRecord({ checkedAt: '2026-10-26T09:40:00.000Z' }),
            checkRecord({ checkedAt: '2026-10-26T09:50:00.000Z' }),
          ],
        },
      ],
      runtimeSources: [
        runtimeState({
          lastCheckedAt: new Date('2026-10-26T09:30:00.000Z'),
          consecutiveFailures: 2,
        }),
      ],
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('recently_healthy');
  });

  it('ready 但尚无检查记录 → verified（核验通过、检查待运行），不是 unverified', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.sources[0]!.state).toBe('verified');
    expect(projection.caliber.verifiedSources).toBe(1);
  });

  it('blocked 来源的人工核验日期（YYYY-MM-DD）不得污染最早核对时间', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry(),
        catalogEntry({
          sourceKey: 'blocked-with-date',
          status: 'blocked',
          verifiedAt: '2026-10-26',
          coverageNote: '入口不可用',
        }),
      ],
      monitoringRecords: [
        {
          sourceKey: 'test-city-education',
          checks: [
            checkRecord({ checkedAt: '2026-10-26T08:30:00.000Z' }),
            checkRecord({ checkedAt: '2026-10-26T09:00:00.000Z' }),
          ],
        },
      ],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    // blocked 来源自身无检查时间
    const blocked = projection.sources.find((source) => source.id === 'blocked-with-date');
    expect(blocked!.lastCheckedAt).toBeNull();
    // 最早核对时间来自检查记录（09:00），不是核验日期的 UTC 零点（00:00）
    expect(projection.lastCheckedAt).toBe('2026-10-26T09:00:00.000Z');
  });
});

describe('buildCoverageProjection：省级状态与口径', () => {
  const freshChecks: SourceMonitoringRecord = {
    sourceKey: 'js-city-education',
    checks: [checkRecord(), checkRecord()],
  };

  it('近期检查正常 + 该省有在报岗位 → open_batch_exists，在报数透传', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry({
          sourceKey: 'js-city-education',
          publisher: '杭州市教育局',
          regionCode: '330100',
        }),
      ],
      monitoringRecords: [freshChecks],
      runtimeSources: null,
      publishedOpenUnits: 12,
      publishedProvinceCodes: ['33'],
    });

    expect(projection.provinces).toHaveLength(1);
    expect(projection.provinces[0]).toMatchObject({
      code: '330000',
      label: '浙江省',
      status: 'open_batch_exists',
    });
    expect(projection.openOpportunityCount).toBe(12);
    expect(projection.provinces[0]!.monitoredRegionCodes).toEqual(['330100']);
  });

  it('近期检查正常但该省无在报岗位 → monitoring_no_open，说明不含虚构数量', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry({
          sourceKey: 'js-city-education',
          regionCode: '330100',
        }),
      ],
      monitoringRecords: [freshChecks],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.provinces[0]!.status).toBe('monitoring_no_open');
    expect(projection.provinces[0]!.scopeNote).toContain('不等于当地没有招聘');
    expect(projection.openOpportunityCount).toBe(0);
  });

  it('runtimeSources=null → isFallback=true 且带非实时说明；有运行时状态 → isFallback=false', () => {
    const base = {
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [freshChecks],
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    };
    const fallback = buildCoverageProjection({ ...base, runtimeSources: null });
    const live = buildCoverageProjection({
      ...base,
      runtimeSources: [runtimeState()],
    });

    expect(fallback.caliber.isFallback).toBe(true);
    expect(fallback.caliber.fallbackNote).toContain('非实时');
    expect(live.caliber.isFallback).toBe(false);
    expect(live.caliber.fallbackNote).toBeNull();
  });

  it('口径字段：generatedAt/version/计数与来源列表一致，lastCheckedAt 取最早检查时间', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry({ sourceKey: 'a', regionCode: '320100' }),
        catalogEntry({
          sourceKey: 'b',
          publisher: '无锡市教育局',
          regionCode: '320200',
        }),
      ],
      monitoringRecords: [
        {
          sourceKey: 'a',
          checks: [checkRecord(), checkRecord({ checkedAt: '2026-10-26T08:30:00.000Z' })],
        },
        {
          sourceKey: 'b',
          checks: [checkRecord(), checkRecord({ checkedAt: '2026-10-26T09:40:00.000Z' })],
        },
      ],
      runtimeSources: null,
      publishedOpenUnits: 3,
      publishedProvinceCodes: ['32'],
    });

    expect(projection.caliber.generatedAt).toBe(NOW.toISOString());
    expect(projection.caliber.version).toBe(COVERAGE_PROJECTION_VERSION);
    expect(projection.caliber.registeredSources).toBe(2);
    expect(projection.caliber.recentlyHealthySources).toBe(2);
    expect(projection.lastCheckedAt).toBe('2026-10-26T08:30:00.000Z');
    // 江苏两地在报 → 省级 open_batch_exists
    expect(projection.provinces[0]!.status).toBe('open_batch_exists');
  });

  it('scopeNote/nextWindowNote 不承诺全国覆盖与窗口时间', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [freshChecks],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.scopeNote).toContain('暂未收录');
    expect(projection.scopeNote).toContain('不代表当地没有招聘');
    expect(projection.nextWindowNote).toContain('以官方公告为准');
    expect(projection.subject).toBe('chinese');
  });

  it('纯函数：同一输入重复构建结果一致', () => {
    const input = {
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [freshChecks],
      runtimeSources: null,
      publishedOpenUnits: 2,
      publishedProvinceCodes: ['32'],
    } as const;
    const first = buildCoverageProjection(input);
    const second = buildCoverageProjection(input);
    expect(second).toEqual(first);
  });
});

describe('deriveProvinceStatus（纯函数）', () => {
  it.each([
    [[], false, 'not_started'],
    [['registered', 'registered'], false, 'registered'],
    [['verified'], false, 'verified'],
    [['recently_healthy'], false, 'monitoring_no_open'],
    [['recently_healthy'], true, 'open_batch_exists'],
    [['paused', 'paused'], true, 'paused'],
    // 暂停不掩盖仍在运行的其它来源
    [['paused', 'recently_healthy'], true, 'open_batch_exists'],
    [['check_failed'], false, 'verified'],
  ] as const)('%j + published=%s → %s', (states, published, expected) => {
    expect(deriveProvinceStatus(states, published)).toBe(expected);
  });
});

describe('真实台账集成', () => {
  it('SOURCE_CATALOG + SOURCE_MONITORING_RECORDS 投影不抛错且计数一致', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: SOURCE_CATALOG,
      monitoringRecords: SOURCE_MONITORING_RECORDS,
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    expect(projection.caliber.registeredSources).toBe(SOURCE_CATALOG.length);
    expect(projection.caliber.recentlyHealthySources).toBe(
      projection.sources.filter((source) => source.state === 'recently_healthy').length,
    );
    // 2026-10-26 的第二次采样在 48 小时窗口内：11 个 ready 来源应为近期正常
    const readyKeys = SOURCE_CATALOG.filter((entry) => entry.status === 'ready').map(
      (entry) => entry.sourceKey,
    );
    const healthyKeys = projection.sources
      .filter((source) => source.state === 'recently_healthy')
      .map((source) => source.id);
    expect(healthyKeys).toEqual(expect.arrayContaining(readyKeys));
    // 每个来源都有判定依据
    for (const source of projection.sources) {
      expect(source.note.length).toBeGreaterThan(0);
    }
  });

  it('省级来源单独成组并标注（省级）；市/区县来源归入所在省', () => {
    const projection = buildCoverageProjection({
      now: NOW,
      sourceCatalog: [
        catalogEntry({
          sourceKey: 'js-province',
          publisher: '江苏省教育厅',
          regionCode: '320000',
          authorityLevel: 'province',
        }),
        catalogEntry({ sourceKey: 'nj', publisher: '南京市教育局', regionCode: '320100' }),
      ],
      monitoringRecords: [],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    });

    const provinceGroup = projection.regions.find((region) => region.code === '320000');
    const cityGroup = projection.regions.find((region) => region.code === '320100');
    expect(provinceGroup!.label).toContain('省级');
    expect(cityGroup!.label).toContain('南京市');
    expect(projection.provinces[0]!.monitoredRegionCodes).toEqual(['320100']);
  });
});

describe('新鲜窗口配置', () => {
  it('默认 48 小时；可用环境变量覆盖；非法值回退默认', () => {
    expect(DEFAULT_FRESHNESS_WINDOW_HOURS).toBe(48);
    expect(getFreshnessWindowHours()).toBe(48);

    const original = process.env.COVERAGE_FRESHNESS_WINDOW_HOURS;
    try {
      process.env.COVERAGE_FRESHNESS_WINDOW_HOURS = '24';
      expect(getFreshnessWindowHours()).toBe(24);
      process.env.COVERAGE_FRESHNESS_WINDOW_HOURS = 'not-a-number';
      expect(getFreshnessWindowHours()).toBe(48);
    } finally {
      if (original === undefined) delete process.env.COVERAGE_FRESHNESS_WINDOW_HOURS;
      else process.env.COVERAGE_FRESHNESS_WINDOW_HOURS = original;
    }
  });

  it('窗口缩小时原本新鲜的检查可以回落为 verified', () => {
    const checks: SourceMonitoringRecord = {
      sourceKey: 'test-city-education',
      checks: [checkRecord(), checkRecord({ checkedAt: '2026-10-26T09:00:00.000Z' })],
    };
    const base = {
      now: NOW,
      sourceCatalog: [catalogEntry()],
      monitoringRecords: [checks],
      runtimeSources: null,
      publishedOpenUnits: 0,
      publishedProvinceCodes: [],
    };
    // 最后检查 10:00Z 前 1 小时：48h 窗口内新鲜，1h 窗口内同样新鲜，2h 窗口也新鲜
    const fresh = buildCoverageProjection({ ...base, freshnessWindowHours: 2 });
    const stale = buildCoverageProjection({ ...base, freshnessWindowHours: 0.5 });

    expect(fresh.sources[0]!.state).toBe('recently_healthy');
    expect(stale.sources[0]!.state).toBe('verified');
  });
});
