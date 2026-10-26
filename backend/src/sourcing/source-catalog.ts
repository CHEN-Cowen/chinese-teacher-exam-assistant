import {
  DEFAULT_CRAWL_SOURCES,
  type DefaultCrawlSource,
} from './default-sources.js';
import {
  type SourceCheckRecord,
  type SourceMonitoringRecord,
} from './source-monitoring.js';

export type SourceCatalogStatus = 'ready' | 'candidate' | 'blocked';
export type SourceAuthorityLevel = 'province' | 'city' | 'district';

export interface SourceCatalogEntry {
  sourceKey: string;
  publisher: string;
  regionCode: string;
  authorityLevel: SourceAuthorityLevel;
  officialUrl: string;
  listUrls: string[];
  allowedHosts: string[];
  adapterKey: string | null;
  status: SourceCatalogStatus;
  /** 只有人工核验完成后才允许进入自动 seed。 */
  verifiedAt: string | null;
  sampleRef: string | null;
  coverageNote: string;
}

/**
 * S5 来源台账：候选项可以先登记，但不等于已启用来源。
 * 候选入口只作为人工核验任务清单，不会被 Worker 自动抓取。
 *
 * 状态口径（沿用 S0 规范）：
 * - ready：入口、适配器、真实样本回放和人工核验齐备，可进入 seed；
 * - candidate：已登记官方入口，等待栏目/附件/持续检查核验；
 * - blocked：核验发现入口不可用或无教师招聘栏目。
 *
 * 注意：ready 只代表“核验通过”，不代表已具备持续监测记录；
 * stableMonitoringVerified 字段由 manifest 记录，未验证前不得对外声称正常监测。
 */
/**
 * 已完成真实栏目核验并具备离线回放样本的来源。
 * 注意：ready 仅表示核验通过，**不代表**已具备持续监测记录。
 *
 * 核验元数据按来源**显式登记**，不从 regionCode 推导行政级别：
 * 行政区划代码后缀规则在直辖市/设区市/县级市上并不可靠
 * （如 320000 是江苏省级、320100 是南京市级、320200 是无锡市级），
 * 用 endsWith('00') 判定会把省级错判为市级、把多数地级市错判为区县级。
 */
const VERIFIED_SOURCE_META: Record<
  string,
  {
    authorityLevel: SourceAuthorityLevel;
    verifiedAt: string;
    sampleRef: string;
  }
> = {
  'nanjing-education': {
    authorityLevel: 'city',
    verifiedAt: '2026-10-21',
    sampleRef: 'tests/fixtures/golden-sources/nanjing',
  },
  'ningbo-education': {
    authorityLevel: 'city',
    verifiedAt: '2026-10-24',
    sampleRef: 'tests/fixtures/golden-sources/ningbo',
  },
  'yinzhou-government': {
    authorityLevel: 'district',
    verifiedAt: '2026-10-24',
    sampleRef: 'tests/fixtures/golden-sources/yinzhou',
  },
  'hangzhou-education': {
    authorityLevel: 'city',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/hangzhou',
  },
};

export const SOURCE_CATALOG: readonly SourceCatalogEntry[] = [
  ...(DEFAULT_CRAWL_SOURCES.map((source) => {
    const meta = VERIFIED_SOURCE_META[source.adapterKey];
    const verified = meta !== undefined;
    return {
      sourceKey: source.adapterKey,
      publisher: source.publisher,
      regionCode: source.regionCode,
      authorityLevel: meta?.authorityLevel ?? 'city',
      officialUrl: source.officialUrl,
      listUrls: source.listUrls,
      allowedHosts: source.allowedHosts,
      // 适配器是否存在与来源核验状态分开记录，候选不得自动 seed。
      adapterKey: source.adapterKey,
      status: verified ? 'ready' : 'candidate',
      verifiedAt: meta?.verifiedAt ?? null,
      sampleRef: meta?.sampleRef ?? null,
      coverageNote: verified
        ? source.adapterKey === 'nanjing-education'
          ? '南京市教育局教师招聘栏目，含分页；已完成历史材料离线回放。'
          : source.adapterKey === 'hangzhou-education'
            ? '「教师招聘」专栏真实核验（2026-10-26）：jpaas 公开接口列表 + 分页、正文与官方附件下载链接离线回放通过；持续监测见检查记录。'
            : '真实栏目与正文/附件已离线回放通过；持续监测见检查记录。'
        : '已登记测试样本和适配器草案；真实栏目、附件和独立清单仍待核验。',
    };
  }) as SourceCatalogEntry[]),
  {
    sourceKey: 'shaoxing-education',
    publisher: '绍兴市教育局',
    regionCode: '330600',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.sx.gov.cn/',
    listUrls: ['https://jyj.sx.gov.cn/col/col1489173/index.html'],
    allowedHosts: ['jyj.sx.gov.cn'],
    adapterKey: 'shaoxing-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/shaoxing',
    coverageNote:
      '「教师招聘」专栏真实核验（2026-10-26）：jpaas 公开接口列表 + 正文与附件离线回放通过；持续监测见检查记录。',
  },
  {
    sourceKey: 'jiaxing-education',
    publisher: '嘉兴市教育局',
    regionCode: '330400',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.jiaxing.gov.cn/',
    listUrls: ['https://jyj.jiaxing.gov.cn/col/col1569769/index.html'],
    allowedHosts: ['jyj.jiaxing.gov.cn'],
    adapterKey: 'jiaxing-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/jiaxing',
    coverageNote:
      '「人才招聘」专栏真实核验（2026-10-26）：公开接口列表 + 正文与附件离线回放通过；列表日期为短格式，年份取自官方文章路径；持续监测见检查记录。',
  },
  {
    sourceKey: 'suzhou-education',
    publisher: '苏州市教育局',
    regionCode: '320500',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.suzhou.gov.cn/',
    listUrls: ['https://jyj.suzhou.gov.cn/szjyj/rsxx/xxgk_list.shtml'],
    allowedHosts: ['jyj.suzhou.gov.cn'],
    adapterKey: 'suzhou-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/suzhou',
    coverageNote:
      '「人事信息」栏目真实核验（2026-10-26）：静态 shtml 列表与分页、正文回放通过；公开招聘公告最新为 2025 年，更新频率低，不得按活跃招聘源展示。',
  },
  {
    sourceKey: 'jiangsu-education-candidate',
    publisher: '江苏省教育厅',
    regionCode: '320000',
    authorityLevel: 'province',
    officialUrl: 'https://jyt.jiangsu.gov.cn/',
    listUrls: [],
    allowedHosts: ['jyt.jiangsu.gov.cn'],
    adapterKey: null,
    status: 'candidate',
    verifiedAt: null,
    sampleRef: null,
    coverageNote:
      '省级候选入口（2026-10-26 首页可达）；核验发现省级教育部门本身不发布市县教师招聘公告，省级来源不能替代市县覆盖。',
  },
  {
    sourceKey: 'zhejiang-education-candidate',
    publisher: '浙江省教育厅',
    regionCode: '330000',
    authorityLevel: 'province',
    officialUrl: 'https://jyt.zj.gov.cn/',
    // 省级来源不登记栏目列表：其「公告公示」为聚合页，未发现独立教师招聘专栏。
    listUrls: [],
    allowedHosts: ['jyt.zj.gov.cn'],
    adapterKey: null,
    status: 'candidate',
    verifiedAt: null,
    sampleRef: null,
    coverageNote:
      '省级候选入口（2026-10-26 可达，公开接口可用）；「公告公示」为聚合页，未发现独立教师招聘专栏，省级来源不能替代市县覆盖。',
  },
  {
    sourceKey: 'wuxi-education-candidate',
    publisher: '无锡市教育局',
    regionCode: '320200',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.wuxi.gov.cn/',
    listUrls: [],
    allowedHosts: ['jyj.wuxi.gov.cn'],
    adapterKey: null,
    status: 'blocked',
    verifiedAt: '2026-10-26',
    sampleRef: null,
    coverageNote:
      '2026-10-26 核验：入口连接失败（fetch failed），暂不可用，待网络或站点恢复后重试。',
  },
  {
    sourceKey: 'huzhou-education-candidate',
    publisher: '湖州市教育局',
    regionCode: '330500',
    authorityLevel: 'city',
    officialUrl: 'https://huedu.huzhou.gov.cn/',
    listUrls: [],
    allowedHosts: ['huedu.huzhou.gov.cn'],
    adapterKey: null,
    status: 'blocked',
    verifiedAt: '2026-10-26',
    sampleRef: null,
    coverageNote:
      '2026-10-26 核验：入口连接失败（fetch failed），暂不可用，待网络或站点恢复后重试。',
  },
  {
    sourceKey: 'changzhou-education',
    publisher: '常州市教育局',
    regionCode: '320400',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.changzhou.gov.cn/',
    listUrls: ['https://jyj.changzhou.gov.cn/class/QFJEPCBL'],
    allowedHosts: ['jyj.changzhou.gov.cn'],
    adapterKey: 'changzhou-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/changzhou',
    coverageNote:
      '「教师招考」专栏真实核验（2026-10-26）：静态表格列表 + 官方 FX_PageDiv 分页、正文与官方附件下载链接回放通过；附件需同源 Referer（已落地到下载链路）；持续监测见检查记录。',
  },
  {
    sourceKey: 'lishui-education',
    publisher: '丽水市教育局',
    regionCode: '331100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.lishui.gov.cn/',
    listUrls: ['https://jyj.lishui.gov.cn/col/col1229223905/index.html'],
    allowedHosts: ['jyj.lishui.gov.cn'],
    adapterKey: 'lishui-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/lishui',
    coverageNote:
      '「人事招聘」专栏真实核验（2026-10-26）：jpaas 公开接口列表（文字列表页app / ajax分页双单元）+ initJpage 分页、正文与官方 xlsx 附件下载链接回放通过；持续监测见检查记录。',
  },
  {
    sourceKey: 'bengbu-education',
    publisher: '蚌埠市教育局',
    regionCode: '340300',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.bengbu.gov.cn/',
    listUrls: ['https://jyj.bengbu.gov.cn/xwdt/kszp/'],
    allowedHosts: ['jyj.bengbu.gov.cn'],
    adapterKey: 'bengbu-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/bengbu',
    coverageNote:
      '「教师招聘」专栏真实核验（2026-10-26）：服务端渲染静态列表 + 官方 pageCount/pageIndex 分页（实测 18 页 / 267 条）、正文与官方 /group4/ 附件下载链接离线回放通过；市级栏目按 S0 规范 6.2 不能替代市县覆盖；持续监测见检查记录。',
  },
  {
    sourceKey: 'xiaoshan-education',
    publisher: '杭州市萧山区教育局',
    regionCode: '330109',
    authorityLevel: 'district',
    officialUrl: 'https://www.xiaoshan.gov.cn/',
    listUrls: ['https://www.xiaoshan.gov.cn/col/col1228964830/index.html'],
    allowedHosts: ['www.xiaoshan.gov.cn'],
    adapterKey: 'xiaoshan-education',
    status: 'ready',
    verifiedAt: '2026-10-26',
    sampleRef: 'tests/fixtures/golden-sources/xiaoshan',
    coverageNote:
      '「教师招考」专栏真实核验（2026-10-26）：jpaas 公开动态接口列表（rows=15 / count=173）+ 官方 paramJson 分页、正文 #zoom 与官方附件下载链接离线回放通过；本来源为区县级层级，按 S0 规范 6.2 独立于杭州市级来源提供区县覆盖；持续监测见检查记录。',
  },
] as const;

export function getSeedableSources(
  catalog: readonly SourceCatalogEntry[] = SOURCE_CATALOG,
): DefaultCrawlSource[] {
  const errors = validateSourceCatalog(catalog);
  if (errors.length) throw new Error(errors.join('; '));
  return catalog
    .filter(
      (
        entry,
      ): entry is SourceCatalogEntry & {
        status: 'ready';
        adapterKey: string;
      } =>
        entry.status === 'ready' &&
        Boolean(entry.adapterKey) &&
        entry.listUrls.length > 0 &&
        entry.verifiedAt !== null &&
        entry.sampleRef !== null,
    )
    .map((entry) => ({
      adapterKey: entry.adapterKey,
      publisher: entry.publisher,
      regionCode: entry.regionCode,
      officialUrl: entry.officialUrl,
      listUrls: entry.listUrls,
      allowedHosts: entry.allowedHosts,
      pollEveryMinutes: 60,
    }));
}

export function validateSourceCatalog(
  catalog: readonly SourceCatalogEntry[] = SOURCE_CATALOG,
): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const hosts = new Set<string>();
  for (const entry of catalog) {
    if (keys.has(entry.sourceKey))
      errors.push(`重复 sourceKey: ${entry.sourceKey}`);
    keys.add(entry.sourceKey);
    if (!/^\d{6}$/.test(entry.regionCode))
      errors.push(`地区代码无效: ${entry.sourceKey}`);
    if (entry.allowedHosts.length === 0)
      errors.push(`缺少 allowedHosts: ${entry.sourceKey}`);
    // 省级教育部门通常不发布市县教师招聘公告；省级来源不得挂栏目列表，
    // 更不得用来代表所辖市县覆盖（见 S0 规范）。
    if (entry.authorityLevel === 'province' && entry.listUrls.length > 0) {
      errors.push(`省级来源不得登记栏目列表: ${entry.sourceKey}`);
    }
    for (const host of entry.allowedHosts) hosts.add(host);
    if (entry.status === 'ready') {
      if (
        !entry.adapterKey ||
        entry.listUrls.length === 0 ||
        !entry.verifiedAt ||
        !entry.sampleRef
      ) {
        errors.push(`ready 来源缺少核验资料: ${entry.sourceKey}`);
      }
    }
    for (const url of [entry.officialUrl, ...entry.listUrls]) {
      try {
        const parsed = new URL(url);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password ||
          !entry.allowedHosts.includes(parsed.hostname)
        ) {
          errors.push(`入口不在 HTTPS 域名白名单: ${entry.sourceKey}`);
        }
      } catch {
        errors.push(`入口 URL 无效: ${entry.sourceKey}`);
      }
    }
  }
  if (catalog.length < 10 || catalog.length > 20) {
    errors.push(`S5 来源数量应为 10-20，当前为 ${catalog.length}`);
  }
  if (hosts.size < 4) errors.push('来源允许域名覆盖不足');
  return errors;
}

/**
 * S5 来源级检查记录登记处。
 *
 * 每条记录都对应一次**真实执行过**的检查，并保留可复算事实：
 * 检查时间、结果、发现条目数、内容指纹。
 *
 * 重要口径（S0 规范「来源台账状态」）：
 * > “正常监测”必须有来源级检查记录，不能仅凭代码中存在适配器判断。
 *
 * 因此：首批来源虽然都完成了真实栏目核验 + 离线回放（`status: 'ready'`），
 * 持续监测要靠**另一次真实检查**才能成立。
 *
 * 2026-10-26 17:00–17:03（UTC 09:00–09:03）对 11 个 ready 来源做了第二次采样：
 * 只再抓栏目入口与实际列表，与第一次黄金样本的条目（标题/日期/链接）比对，
 * **不覆盖**已核验的黄金样本。
 * - 南京：首屏 15 条全部更换（最新由 2026-03-18 变为 2026-09-14），记 `succeeded`；
 * - 其余 10 个：列表条目与第一次完全一致，记 `no_new`（算成功，不算新内容）。
 * 连续成功达到阈值后，状态由记录推导为 `monitoring`，不在这里手写。
 *
 * 后续由真实调度 Worker 产生的检查结果应追加到这里（或落库后由
 * `summarizeAllMonitoring` 汇总）。
 */
export const SOURCE_MONITORING_RECORDS: readonly SourceMonitoringRecord[] = [
  {
    sourceKey: 'nanjing-education',
    checks: [
      {
        checkedAt: '2026-10-21T00:00:00.000Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：列表页与正文页抓取成功并落离线样本；未做条目级计数与指纹留痕。',
      },
      {
        checkedAt: '2026-10-26T09:02:59.964Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash:
          '2dabaabf6b9e545d02e2aebe7dc378ffd40cb41dc0964bcaf4c1a3617da960c4',
        note: '第二次真实采样（距首次 5 天）：栏目 HTTP 200，首屏 15 条与 2026-10-21 黄金样本全部不同，最新公告由 2026-03-18 变为 2026-09-14。指纹为标题+日期+链接的 sha256。',
      },
    ],
  },
  {
    sourceKey: 'hangzhou-education',
    checks: [
      {
        checkedAt: '2026-10-26T03:29:35.478Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：jpaas 公开接口列表（含分页）与正文、官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:06.075Z',
        outcome: 'no_new',
        discoveredCount: 30,
        contentHash:
          'e00bc18be4a11d4105a5ac6f95ccc60556301d5f4373fb76f5572ed630a13b4c',
        note: '第二次真实采样（距首次约 5.5 小时）：栏目 HTTP 200，公开列表 30 条标题/日期/链接与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'ningbo-education',
    checks: [
      {
        checkedAt: '2026-10-24T14:14:37.873Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：公开接口列表与正文回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:06.660Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          'f8615b0ff6a008cb78a0ac79af7fdef86a7e4027e67bf8d6b5e5cdfd8c93d3d1',
        note: '第二次真实采样（距首次约 43 小时）：栏目 HTTP 200，公开列表 15 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'yinzhou-government',
    checks: [
      {
        checkedAt: '2026-10-24T14:14:37.901Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：公开接口列表与正文回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:07.293Z',
        outcome: 'no_new',
        discoveredCount: 30,
        contentHash:
          'b37c74514ca17505624025860d7501110bb5ecabd5ea19def7ed9dcb3cb089db',
        note: '第二次真实采样（距首次约 43 小时）：栏目 HTTP 200，公开列表 30 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'shaoxing-education',
    checks: [
      {
        checkedAt: '2026-10-26T02:09:31.002Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：jpaas 公开接口列表、正文与官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:07.875Z',
        outcome: 'no_new',
        discoveredCount: 18,
        contentHash:
          '059893224eae7986235232163f8c19ae959716212741ab6b5c7eea2e4532e782',
        note: '第二次真实采样（距首次约 7 小时）：栏目 HTTP 200，公开列表 18 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'jiaxing-education',
    checks: [
      {
        checkedAt: '2026-10-26T02:09:32.033Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：公开接口列表、正文与官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:08.423Z',
        outcome: 'no_new',
        discoveredCount: 20,
        contentHash:
          '6d125b8e5bd6609598f6cbe2aac6b24924a368301b42cf0fc7d681e0583adb3b',
        note: '第二次真实采样（距首次约 7 小时）：栏目 HTTP 200，公开列表 20 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'suzhou-education',
    checks: [
      {
        checkedAt: '2026-10-26T02:09:32.869Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：公开列表接口、正文与官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:09.003Z',
        outcome: 'no_new',
        discoveredCount: 57,
        contentHash:
          '16d11564f8958a51c25f703f3179659c93054214cdf50d8db0648427e47720d9',
        note: '第二次真实采样（距首次约 7 小时）：栏目 HTTP 200，静态列表 57 条与首次黄金样本完全一致。外壳页有 1 字节差，条目本身未变。',
      },
    ],
  },
  {
    sourceKey: 'changzhou-education',
    checks: [
      {
        checkedAt: '2026-10-26T02:47:27.596Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：公开列表接口、正文与官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:09.281Z',
        outcome: 'no_new',
        discoveredCount: 20,
        contentHash:
          '210bcc4a76fa21c5bd5cf2da6b6841c0b42066f9dc31eb3e2aefbb2630ba81fb',
        note: '第二次真实采样（距首次约 6 小时）：栏目 HTTP 200，表格列表 20 条与首次黄金样本完全一致。外壳页字节有差，条目本身未变。',
      },
    ],
  },
  {
    sourceKey: 'lishui-education',
    checks: [
      {
        checkedAt: '2026-10-26T04:08:21.242Z',
        outcome: 'succeeded',
        discoveredCount: null,
        contentHash: null,
        note: '首次真实采样：jpaas 公开接口列表（initJpage 分页）、正文与官方 xlsx 附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:02:09.491Z',
        outcome: 'no_new',
        discoveredCount: 10,
        contentHash:
          '10e0a95f7718de43ed55507dca5006cdb7904ae264e4f037eea1ed91bbc0c74c',
        note: '第二次真实采样（距首次约 5 小时）：栏目 HTTP 200，公开列表 10 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'bengbu-education',
    checks: [
      {
        checkedAt: '2026-10-26T08:47:12.061Z',
        outcome: 'succeeded',
        discoveredCount: 9,
        contentHash: null,
        note: '首次真实采样：服务端渲染静态列表（首屏 9 条）+ 官方 pageCount 分页（18 页 / 267 条）、正文与官方 /group4/ 附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:05:49.593Z',
        outcome: 'no_new',
        discoveredCount: 9,
        contentHash:
          'afff501d5e942a01c74e4dcac582a372e388915a7ecb16b0c805332581072aab',
        note: '第二次真实采样（距首次约 18 分钟）：栏目 HTTP 200，教师招聘路径下 9 条与首次黄金样本完全一致。',
      },
    ],
  },
  {
    sourceKey: 'xiaoshan-education',
    checks: [
      {
        checkedAt: '2026-10-26T08:50:44.919Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: '首次真实采样：jpaas 公开动态接口列表（rows=15 / count=173）、官方 paramJson 分页、正文 #zoom 与官方附件下载链接回放通过。',
      },
      {
        checkedAt: '2026-10-26T09:05:49.593Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          '305e3f75f4c007f03f15fbf4c833c5f0faf5132a61569e9578ecfd9b38de3c29',
        note: '第二次真实采样（距首次约 15 分钟）：栏目 HTTP 200，教师招考列表 15 条与首次黄金样本完全一致。',
      },
    ],
  },
];

/** 目录中全部来源的 sourceKey 列表（含 candidate/blocked）。 */
export function getCatalogSourceKeys(
  catalog: readonly SourceCatalogEntry[] = SOURCE_CATALOG,
): string[] {
  return catalog.map((entry) => entry.sourceKey);
}

/**
 * 取出某个来源的检查记录；没有记录时返回空记录（状态即 `unverified`）。
 *
 * 查不到记录**不抛错**——「没登记」是合法状态，等价于「尚未监测」，
 * 不能因为某个来源漏登记就让整个台账挂掉。
 */
export function getSourceMonitoringRecord(
  sourceKey: string,
  records: readonly SourceMonitoringRecord[] = SOURCE_MONITORING_RECORDS,
): SourceMonitoringRecord {
  return (
    records.find((record) => record.sourceKey === sourceKey) ?? {
      sourceKey,
      checks: [],
    }
  );
}

/**
 * 追加一次检查记录（按时间升序插入）。
 *
 * 纯函数：返回新数组，不修改入参，便于在测试与离线核对中复算。
 */
export function appendSourceCheck(
  records: readonly SourceMonitoringRecord[],
  sourceKey: string,
  check: SourceCheckRecord,
): SourceMonitoringRecord[] {
  const index = records.findIndex((record) => record.sourceKey === sourceKey);
  if (index === -1) {
    return [...records, { sourceKey, checks: [check] }];
  }
  const existing = records[index]!;
  const next = [...records];
  next[index] = {
    sourceKey,
    checks: [...existing.checks, check].sort((a, b) =>
      a.checkedAt.localeCompare(b.checkedAt),
    ),
  };
  return next;
}
