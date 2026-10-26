/**
 * M01（F1/F2）：统一服务端覆盖投影。
 *
 * 背景（整体方案 F1/F2，2026-10-26）：
 * - F1：`GET /opportunities/coverage` 声明为首页公开接口，但全局会话守卫的
 *   公开路径未包含它，invited 模式下匿名请求 401，访客首页只能用旧静态镜像；
 * - F2：扩源台账（SOURCE_CATALOG / SOURCE_MONITORING_RECORDS，含南京、苏州、
 *   常州、蚌埠等记录）与用户端覆盖（matching/coverage.ts 的 REAL_COVERAGE，
 *   核对时间停在 2026-10-06、江苏标记未开始）是两套事实来源，且前端
 *   lib/guest/coverage.ts 又手工镜像一份旧口径。
 *
 * 本模块建立唯一的服务端覆盖投影，作为公开覆盖接口与 match 响应的共同来源：
 * - 来源级状态区分：已登记（registered）、核验通过（verified）、
 *   近期检查正常（recently_healthy）、检查失败（check_failed）、
 *   主动暂停（paused）、核验不可用（blocked）；
 * - 省级状态区分：未收录（not_started）、已登记（registered）、
 *   已核验（verified）、监测中无在报（monitoring_no_open）、
 *   监测中存在在报（open_batch_exists）、暂停（paused）；
 * - 已发布岗位数与用户匹配共用同一目录口径；
 * - 响应携带统计口径（caliber）、生成时间与投影版本；
 * - 运行时 Source 表不可用时回退台账静态投影，并显式标注 degraded 与
 *   非实时说明，不把回退描述成实时信息；
 * - 访客与登录用户调用同一接口、同一事实来源。
 *
 * 口径纪律：
 * - 「已登记」「核验通过」不代表已有在报岗位，也不代表全国覆盖；
 * - 近期检查正常必须同时满足：连续检查达阈值（monitoring）且最近检查
 *   在新鲜窗口内；窗口过期显示「检查超时/待确认」，不能永远正常；
 * - 未列出的省份一律视为「暂未收录」，「暂未收录」不代表当地没有招聘。
 */
import type { SourceCatalogEntry } from '../sourcing/source-catalog.js';
import { summarizeMonitoring } from '../sourcing/source-monitoring.js';
import type { SourceMonitoringRecord } from '../sourcing/source-monitoring.js';

/** 投影口径版本：来源状态模型或统计口径变化时递增。 */
export const COVERAGE_PROJECTION_VERSION = 'coverage-projection-2.0.0';

/**
 * 「近期检查正常」的新鲜窗口（小时）。
 *
 * 台账来源默认调度周期为 60 分钟（getSeedableSources 的 pollEveryMinutes）。
 * 窗口取 48 小时：Worker 正常时远小于该值；Worker 停止或来源转为人工采样时，
 * 超过窗口即回落为「已核验·检查待运行」，不能一直显示「近期检查正常」。
 * 可用环境变量 COVERAGE_FRESHNESS_WINDOW_HOURS 覆盖（M02 接调度后按来源周期细化）。
 */
export const DEFAULT_FRESHNESS_WINDOW_HOURS = 48;

export function getFreshnessWindowHours(): number {
  const raw = Number(process.env.COVERAGE_FRESHNESS_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FRESHNESS_WINDOW_HOURS;
}

/** 来源级投影状态。 */
export type ProjectionSourceState =
  /** 已登记官方入口，等待栏目/附件/持续检查核验（candidate） */
  | 'registered'
  /** 核验通过（ready），但近期检查未运行、未达阈值或已超窗 */
  | 'verified'
  /** 近期检查正常：连续检查达标且最近检查在新鲜窗口内 */
  | 'recently_healthy'
  /** 最近检查失败或结构变化，需要处理 */
  | 'check_failed'
  /** 来源被主动暂停自动检查 */
  | 'paused'
  /** 核验发现入口不可用或无教师招聘栏目 */
  | 'blocked';

export const PROJECTION_SOURCE_STATE_LABELS: Record<ProjectionSourceState, string> = {
  registered: '已登记 · 待核验',
  verified: '已核验 · 检查待运行',
  recently_healthy: '近期检查正常',
  check_failed: '检查失败 · 待处理',
  paused: '已暂停',
  blocked: '核验不可用',
};

/** 运行时 Source 表的投影所需字段（避免直接依赖 Prisma 类型）。 */
export interface RuntimeSourceState {
  /** 关联台账 sourceKey（= Source.adapterKey） */
  adapterKey: string | null;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastCheckedAt: Date | null;
  consecutiveFailures: number;
}

export interface ProjectionSource {
  /** 台账 sourceKey（与 Source.adapterKey 对应） */
  id: string;
  name: string;
  url: string;
  /** 6 位行政区划代码（省/市/区县级） */
  regionCode: string;
  authorityLevel: SourceCatalogEntry['authorityLevel'];
  state: ProjectionSourceState;
  /** 最近一次检查时间；无检查记录为 null */
  lastCheckedAt: string | null;
  /** 人类可读的判定依据 */
  note: string;
}

/** 省级投影状态。 */
export type ProjectionProvinceStatus =
  | 'not_started'
  | 'registered'
  | 'verified'
  | 'monitoring_no_open'
  | 'open_batch_exists'
  | 'paused';

export interface ProjectionProvince {
  code: string;
  label: string;
  status: ProjectionProvinceStatus;
  /** 该省已登记市/区县级来源的地区代码；省级候选不计入 */
  monitoredRegionCodes: string[];
  scopeNote: string;
}

export interface ProjectionRegion {
  code: string;
  label: string;
  authority: string;
  sources: ProjectionSource[];
}

/** 统计口径：让用户端可以如实展示「按什么口径统计、何时生成」。 */
export interface ProjectionCaliber {
  /** 投影生成时间（服务端时钟，ISO） */
  generatedAt: string;
  /** 投影口径版本 */
  version: string;
  /** 台账登记来源总数（含候选与不可用） */
  registeredSources: number;
  /** 核验通过来源数 */
  verifiedSources: number;
  /** 近期检查正常来源数 */
  recentlyHealthySources: number;
  /** 检查失败/结构变化来源数 */
  failedSources: number;
  /** 主动暂停来源数 */
  pausedSources: number;
  /** 核验不可用来源数 */
  blockedSources: number;
  /** 当前在报岗位数（与用户匹配同一已发布目录口径） */
  publishedOpenUnits: number;
  /** 运行时数据不可用、使用台账静态投影回退 */
  isFallback: boolean;
  /** 回退说明；正常时为 null */
  fallbackNote: string | null;
}

export interface UnifiedCoverageProjection {
  version: string;
  subject: 'chinese';
  subjectLabel: string;
  status: ProjectionProvinceStatus;
  provinces: ProjectionProvince[];
  regions: ProjectionRegion[];
  /** 扁平来源列表（含状态与判定依据），与 regions 内的 sources 同构 */
  sources: ProjectionSource[];
  /** 全部来源最近检查时间的最早值（「自该时间起核对过」的诚实口径） */
  lastCheckedAt: string;
  openOpportunityCount: number;
  nextWindowNote: string;
  scopeNote: string;
  caliber: ProjectionCaliber;
}

export interface CoverageProjectionInput {
  now: Date;
  sourceCatalog: readonly SourceCatalogEntry[];
  monitoringRecords: readonly SourceMonitoringRecord[];
  /** 运行时 Source 表状态；null 表示数据库不可用（回退静态台账） */
  runtimeSources: readonly RuntimeSourceState[] | null;
  /** 当前在报岗位数（已发布目录口径） */
  publishedOpenUnits: number;
  /** 在报岗位覆盖的省级代码（regionCode 前 2 位） */
  publishedProvinceCodes: readonly string[];
  /** 新鲜窗口小时数；缺省读环境变量 */
  freshnessWindowHours?: number;
}

/** 省级行政区划代码 → 名称（覆盖数据，不是来源台账）。 */
const PROVINCE_LABELS: Record<string, string> = {
  '11': '北京市',
  '12': '天津市',
  '13': '河北省',
  '14': '山西省',
  '15': '内蒙古自治区',
  '21': '辽宁省',
  '22': '吉林省',
  '23': '黑龙江省',
  '31': '上海市',
  '32': '江苏省',
  '33': '浙江省',
  '34': '安徽省',
  '35': '福建省',
  '36': '江西省',
  '37': '山东省',
  '41': '河南省',
  '42': '湖北省',
  '43': '湖南省',
  '44': '广东省',
  '45': '广西壮族自治区',
  '46': '海南省',
  '50': '重庆市',
  '51': '四川省',
  '52': '贵州省',
  '53': '云南省',
  '54': '西藏自治区',
  '61': '陕西省',
  '62': '甘肃省',
  '63': '青海省',
  '64': '宁夏回族自治区',
  '65': '新疆维吾尔自治区',
};

/** 从发布单位名称推导地区短名（如「杭州市教育局」→「杭州市」）。 */
function derivePlaceLabel(publisher: string): string {
  return publisher.replace(/(教育局|教育厅|人力资源和社会保障局|人社局)$/, '');
}

function isFresh(lastCheckedAt: string | null, now: Date, windowHours: number): boolean {
  if (!lastCheckedAt) return false;
  const checked = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(checked)) return false;
  return now.getTime() - checked <= windowHours * 3600_000;
}

/**
 * 推导单个来源的投影状态。
 *
 * 运行时状态（Source 表）优先于台账检查记录：主动暂停、连续失败是运行时
 * 事实。运行时不可用时整体回退台账静态投影（isFallback），来源状态只由
 * 台账与检查记录推导。
 */
function deriveSourceState(
  entry: SourceCatalogEntry,
  record: SourceMonitoringRecord | undefined,
  runtime: RuntimeSourceState | undefined,
  now: Date,
  windowHours: number,
): { state: ProjectionSourceState; note: string; lastCheckedAt: string | null } {
  const lastCheckFromRecord = record?.checks.length
    ? record.checks[record.checks.length - 1]!
    : null;

  if (runtime) {
    if (!runtime.enabled) {
      return {
        state: 'paused',
        note: '来源已主动暂停自动检查。',
        lastCheckedAt: runtime.lastCheckedAt?.toISOString() ?? lastCheckFromRecord?.checkedAt ?? null,
      };
    }
    // 运行时连续失败且检查时间不早于台账记录时，以运行时失败为准。
    if (
      runtime.consecutiveFailures > 0 &&
      (!lastCheckFromRecord ||
        (runtime.lastCheckedAt?.getTime() ?? 0) >= new Date(lastCheckFromRecord.checkedAt).getTime())
    ) {
      return {
        state: 'check_failed',
        note: `运行时连续失败 ${runtime.consecutiveFailures} 次，需要处理。`,
        lastCheckedAt: runtime.lastCheckedAt?.toISOString() ?? null,
      };
    }
  }

  if (entry.status === 'blocked') {
    return {
      state: 'blocked',
      note: entry.coverageNote,
      // lastCheckedAt 只收来源级检查时间；verifiedAt 是人工核验日期（YYYY-MM-DD），
      // 混入会把「最早核对时间」污染成核验日期的零点，不能用于 freshness 口径。
      lastCheckedAt: lastCheckFromRecord?.checkedAt ?? null,
    };
  }
  if (entry.status === 'candidate') {
    return {
      state: 'registered',
      note: entry.coverageNote,
      lastCheckedAt: lastCheckFromRecord?.checkedAt ?? null,
    };
  }

  // status === 'ready'：由检查记录推导（复用 source-monitoring 的唯一判定入口）
  const summary = summarizeMonitoring(record ?? { sourceKey: entry.sourceKey, checks: [] });
  const lastCheckedAt = summary.lastCheckedAt;
  if (summary.state === 'degraded') {
    return { state: 'check_failed', note: summary.reason, lastCheckedAt };
  }
  if (summary.state === 'paused') {
    return { state: 'paused', note: summary.reason, lastCheckedAt };
  }
  if (summary.state === 'monitoring') {
    if (isFresh(lastCheckedAt, now, windowHours)) {
      return { state: 'recently_healthy', note: summary.reason, lastCheckedAt };
    }
    return {
      state: 'verified',
      note: `检查超时/待确认：最近一次检查在 ${lastCheckedAt}，超过 ${windowHours} 小时新鲜窗口。`,
      lastCheckedAt,
    };
  }
  return {
    state: 'verified',
    note: summary.reason,
    lastCheckedAt,
  };
}

/** 省级状态推导（纯函数，与来源状态一致口径）。 */
export function deriveProvinceStatus(
  sourceStates: readonly ProjectionSourceState[],
  hasPublishedOpenUnits: boolean,
): ProjectionProvinceStatus {
  if (sourceStates.length === 0) return 'not_started';
  if (sourceStates.every((state) => state === 'paused')) return 'paused';
  if (sourceStates.some((state) => state === 'recently_healthy')) {
    return hasPublishedOpenUnits ? 'open_batch_exists' : 'monitoring_no_open';
  }
  if (sourceStates.some((state) => state === 'verified' || state === 'check_failed')) {
    return 'verified';
  }
  return 'registered';
}

const PROVINCE_STATUS_NOTES: Record<ProjectionProvinceStatus, string> = {
  not_started: '该省暂无任何已登记官方来源：接入前全省均为「暂未收录」，不代表当地没有招聘。',
  registered: '该省来源已登记官方入口，栏目与持续检查仍在核验中；暂无核验通过的来源。',
  verified:
    '该省已有核验通过来源，但近期检查未运行、未达连续阈值或已超窗；已核验不代表当前有在报岗位。',
  monitoring_no_open: '该省来源近期检查正常，当前无在报岗位批次；「无在报」不等于当地没有招聘。',
  open_batch_exists: '该省来源近期检查正常，且当前存在已发布、在报名窗口内的岗位。',
  paused: '该省来源当前全部主动暂停自动检查，覆盖数据停留在暂停前状态。',
};

/**
 * 构建统一覆盖投影。
 *
 * 纯函数：同一份输入必然得到同一投影，可复算、可测试。
 */
export function buildCoverageProjection(input: CoverageProjectionInput): UnifiedCoverageProjection {
  const {
    now,
    sourceCatalog,
    monitoringRecords,
    runtimeSources,
    publishedOpenUnits,
    publishedProvinceCodes,
  } = input;
  const windowHours = input.freshnessWindowHours ?? getFreshnessWindowHours();
  const runtimeByKey = new Map<string, RuntimeSourceState>();
  if (runtimeSources) {
    for (const row of runtimeSources) {
      if (row.adapterKey) runtimeByKey.set(row.adapterKey, row);
    }
  }
  const recordByKey = new Map(monitoringRecords.map((record) => [record.sourceKey, record]));
  const publishedProvinces = new Set(publishedProvinceCodes);

  const sources: ProjectionSource[] = sourceCatalog.map((entry) => {
    const { state, note, lastCheckedAt } = deriveSourceState(
      entry,
      recordByKey.get(entry.sourceKey),
      runtimeSources ? runtimeByKey.get(entry.sourceKey) : undefined,
      now,
      windowHours,
    );
    return {
      id: entry.sourceKey,
      name: entry.publisher,
      url: entry.officialUrl,
      regionCode: entry.regionCode,
      authorityLevel: entry.authorityLevel,
      state,
      lastCheckedAt,
      note,
    };
  });

  // 地区聚合：按 regionCode 分组；地区短名从发布单位推导。
  const regionsByCode = new Map<string, ProjectionRegion>();
  for (const source of sources) {
    const existing = regionsByCode.get(source.regionCode);
    if (existing) {
      existing.sources.push(source);
    } else {
      const provinceCode = source.regionCode.slice(0, 2);
      const provinceLabel = PROVINCE_LABELS[provinceCode] ?? `地区 ${provinceCode}`;
      const place = derivePlaceLabel(source.name) || source.name;
      const isProvinceLevel = source.authorityLevel === 'province';
      regionsByCode.set(source.regionCode, {
        code: source.regionCode,
        label: isProvinceLevel ? `${provinceLabel}（省级）` : `${provinceLabel}·${place}`,
        authority: source.name,
        sources: [source],
      });
    }
  }

  // 省级聚合：regionCode 前 2 位归省。
  const provinceCodes = [...new Set(sources.map((source) => source.regionCode.slice(0, 2)))];
  const provinces: ProjectionProvince[] = provinceCodes.map((provinceCode) => {
    const provinceSources = sources.filter(
      (source) => source.regionCode.slice(0, 2) === provinceCode,
    );
    const status = deriveProvinceStatus(
      provinceSources.map((source) => source.state),
      publishedProvinces.has(provinceCode),
    );
    return {
      code: `${provinceCode}0000`,
      label: PROVINCE_LABELS[provinceCode] ?? `地区 ${provinceCode}`,
      status,
      monitoredRegionCodes: [
        ...new Set(
          provinceSources
            .filter((source) => source.authorityLevel !== 'province')
            .map((source) => source.regionCode),
        ),
      ],
      scopeNote: PROVINCE_STATUS_NOTES[status],
    };
  });

  // 排序：省级状态优先级（在报 > 监测 > 核验 > 登记 > 暂停），同状态按代码。
  const statusOrder: Record<ProjectionProvinceStatus, number> = {
    open_batch_exists: 0,
    monitoring_no_open: 1,
    verified: 2,
    registered: 3,
    paused: 4,
    not_started: 5,
  };
  provinces.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.code.localeCompare(b.code));

  const checkedTimes = sources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  const topStatus: ProjectionProvinceStatus = provinces.some((p) => p.status === 'open_batch_exists')
    ? 'open_batch_exists'
    : provinces.some((p) => p.status === 'monitoring_no_open')
      ? 'monitoring_no_open'
      : provinces.some((p) => p.status === 'verified')
        ? 'verified'
        : provinces.some((p) => p.status === 'registered')
          ? 'registered'
          : provinces.some((p) => p.status === 'paused')
            ? 'paused'
            : 'not_started';

  const isFallback = runtimeSources === null;

  return {
    version: COVERAGE_PROJECTION_VERSION,
    subject: 'chinese',
    subjectLabel: '语文教师',
    status: topStatus,
    provinces,
    regions: [...regionsByCode.values()],
    sources,
    lastCheckedAt: checkedTimes.length
      ? new Date(Math.min(...checkedTimes)).toISOString()
      : now.toISOString(),
    openOpportunityCount: publishedOpenUnits,
    nextWindowNote:
      '各地招聘窗口以官方公告为准：本服务持续监测已登记来源，发现新公告后经人工审核发布，不预先承诺窗口时间。',
    scopeNote:
      '覆盖按官方来源台账与最近检查记录汇总：已登记/核验通过不代表已有在报岗位；近期检查正常指最近检查在新鲜窗口内且连续达标。未列出的省份均为「暂未收录」，「暂未收录」不代表当地没有招聘。',
    caliber: {
      generatedAt: now.toISOString(),
      version: COVERAGE_PROJECTION_VERSION,
      registeredSources: sources.length,
      verifiedSources: sources.filter((s) => s.state === 'verified').length,
      recentlyHealthySources: sources.filter((s) => s.state === 'recently_healthy').length,
      failedSources: sources.filter((s) => s.state === 'check_failed').length,
      pausedSources: sources.filter((s) => s.state === 'paused').length,
      blockedSources: sources.filter((s) => s.state === 'blocked').length,
      publishedOpenUnits,
      isFallback,
      fallbackNote: isFallback
        ? '运行状态数据库暂不可用：以下为来源台账静态投影（非实时），恢复后自动回到实时口径。'
        : null,
    },
  };
}
