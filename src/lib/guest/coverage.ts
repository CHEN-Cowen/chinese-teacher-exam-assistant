/**
 * 访客侧「官方监测覆盖」静态快照（M01/F2 统一覆盖投影口径）。
 *
 * 用途：/onboarding /preview 等不调用后端的访客页面，以及首页公开覆盖接口
 * 尚未返回时的初始渲染。首页真实数据来自公开接口
 * GET /api/opportunities/coverage（M01/F1 后匿名可达），与本快照同构。
 *
 * 与后端事实源的关系：本文件是
 * backend/src/opportunities/coverage-projection.ts 对来源台账
 * （SOURCE_CATALOG + SOURCE_MONITORING_RECORDS，截至 2026-10-26 第二次
 * 真实采样）的一次静态投影快照，caliber.isFallback = true 且明示非实时。
 * 台账或检查记录更新时需人工同步本文件并更新 guest/coverage.test.ts；
 * 持续采集闭环（M02/M08）落地后，访客预览页将改为运行时取数，本快照退役。
 *
 * 口径纪律与后端一致：
 * - 已登记/核验通过不代表已有在报岗位；
 * - 「近期检查正常」= 连续检查达标且最近检查在新鲜窗口内（快照时点成立）；
 * - 未列出的省份均为「暂未收录」，不代表当地没有招聘。
 */
import type {
  CoverageDTO,
  CoverageRegionDTO,
  CoverageSourceDTO,
} from "@/lib/opportunities/api-types";

/** 本快照最近一次与后端台账核对的日期（代码维护用，展示取 coverage.lastCheckedAt） */
export const GUEST_COVERAGE_LAST_UPDATED = "2026-10-26";

const FALLBACK_NOTE =
  "静态快照（非实时）：本页覆盖信息来自 2026-10-26 的官方来源台账与检查记录投影；打开首页后自动刷新为实时口径。";

/** 全部 17 个官方来源（江苏省/浙江省/安徽省），与后端台账逐字对应 */
const ALL_SOURCES: CoverageSourceDTO[] = [
  // 江苏省（320000）
  {
    id: "jiangsu-education-candidate",
    name: "江苏省教育厅",
    url: "https://jyt.jiangsu.gov.cn/",
    regionCode: "320000",
    authorityLevel: "province",
    state: "registered",
    lastCheckedAt: null,
    note: "省级候选入口（2026-10-26 首页可达）；核验发现省级教育部门本身不发布市县教师招聘公告，省级来源不能替代市县覆盖。",
  },
  {
    id: "nanjing-education",
    name: "南京市教育局",
    url: "https://edu.nanjing.gov.cn/bsfw/zpzk/",
    regionCode: "320100",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:59.964Z",
    note: "教师招聘栏目，含分页；第二次真实采样（距首次 5 天）：首屏 15 条全部更换，最新公告由 2026-03-18 变为 2026-09-14。",
  },
  {
    id: "wuxi-education-candidate",
    name: "无锡市教育局",
    url: "https://jyj.wuxi.gov.cn/",
    regionCode: "320200",
    authorityLevel: "city",
    state: "blocked",
    lastCheckedAt: null,
    note: "核验发现入口不可用或无教师招聘栏目（2026-10-26）。",
  },
  {
    id: "changzhou-education",
    name: "常州市教育局",
    url: "https://jyj.changzhou.gov.cn/",
    regionCode: "320400",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:09.281Z",
    note: "公开列表接口、正文与官方附件下载链接回放通过；第二次真实采样（距首次约 6 小时）与首次黄金样本一致。",
  },
  {
    id: "suzhou-education",
    name: "苏州市教育局",
    url: "https://jyj.suzhou.gov.cn/",
    regionCode: "320500",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:09.003Z",
    note: "公开列表接口、正文与官方附件下载链接回放通过；第二次真实采样（距首次约 7 小时）与首次黄金样本一致。",
  },
  // 浙江省（330000）
  {
    id: "zhejiang-education-candidate",
    name: "浙江省教育厅",
    url: "https://jyt.zj.gov.cn/",
    regionCode: "330000",
    authorityLevel: "province",
    state: "registered",
    lastCheckedAt: null,
    note: "省级候选入口（2026-10-26 可达，公开接口可用）；「公告公示」为聚合页，未发现独立教师招聘专栏，省级来源不能替代市县覆盖。",
  },
  {
    id: "huzhou-education-candidate",
    name: "湖州市教育局",
    url: "https://huedu.huzhou.gov.cn/",
    regionCode: "330500",
    authorityLevel: "city",
    state: "blocked",
    lastCheckedAt: null,
    note: "核验发现入口不可用或无教师招聘栏目（2026-10-26）。",
  },
  {
    id: "hangzhou-education",
    name: "杭州市教育局",
    url: "https://edu.hangzhou.gov.cn/",
    regionCode: "330100",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:06.075Z",
    note: "「教师招聘」专栏真实核验（2026-10-26）：jpaas 公开接口列表 + 分页、正文与官方附件下载链接离线回放通过；持续监测见检查记录。",
  },
  {
    id: "xiaoshan-education",
    name: "杭州市萧山区教育局",
    url: "https://www.xiaoshan.gov.cn/",
    regionCode: "330109",
    authorityLevel: "district",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:05:49.593Z",
    note: "jpaas 公开动态接口列表（rows=15 / count=173）、官方 paramJson 分页、正文 #zoom 与官方附件下载链接回放通过；第二次真实采样与首次黄金样本一致。",
  },
  {
    id: "ningbo-education",
    name: "宁波市教育局",
    url: "https://jyj.ningbo.gov.cn/",
    regionCode: "330200",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:06.660Z",
    note: "公开接口列表与正文回放通过；第二次真实采样（距首次约 43 小时）与首次黄金样本一致。",
  },
  {
    id: "yinzhou-government",
    name: "宁波市鄞州区人民政府",
    url: "https://www.nbyz.gov.cn/",
    regionCode: "330212",
    authorityLevel: "district",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:07.293Z",
    note: "公开接口列表与正文回放通过；第二次真实采样（距首次约 43 小时）与首次黄金样本一致。",
  },
  {
    id: "jiaxing-education",
    name: "嘉兴市教育局",
    url: "https://jyj.jiaxing.gov.cn/",
    regionCode: "330400",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:08.423Z",
    note: "公开接口列表、正文与官方附件下载链接回放通过；第二次真实采样（距首次约 7 小时）与首次黄金样本一致。",
  },
  {
    id: "shaoxing-education",
    name: "绍兴市教育局",
    url: "https://jyj.sx.gov.cn/",
    regionCode: "330600",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:07.875Z",
    note: "jpaas 公开接口列表、正文与官方附件下载链接回放通过；第二次真实采样（距首次约 7 小时）与首次黄金样本一致。",
  },
  {
    id: "lishui-education",
    name: "丽水市教育局",
    url: "https://jyj.lishui.gov.cn/",
    regionCode: "331100",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:02:09.491Z",
    note: "jpaas 公开接口列表（initJpage 分页）、正文与官方 xlsx 附件下载链接回放通过；第二次真实采样（距首次约 5 小时）与首次黄金样本一致。",
  },
  // 安徽省（340000）
  {
    id: "bengbu-education",
    name: "蚌埠市教育局",
    url: "https://jyj.bengbu.gov.cn/",
    regionCode: "340300",
    authorityLevel: "city",
    state: "recently_healthy",
    lastCheckedAt: "2026-10-26T09:05:49.593Z",
    note: "服务端渲染静态列表 + 官方分页（18 页）、正文与官方附件下载链接回放通过；第二次真实采样（距首次约 18 分钟）与首次黄金样本一致。",
  },
];

function sourcesByRegion(code: string): CoverageSourceDTO[] {
  return ALL_SOURCES.filter((source) => source.regionCode === code);
}

function region(
  code: string,
  label: string,
  authority: string,
): CoverageRegionDTO {
  return { code, label, authority, sources: sourcesByRegion(code) };
}

export const GUEST_COVERAGE: CoverageDTO = {
  version: "coverage-projection-2.0.0",
  subject: "chinese",
  subjectLabel: "语文教师",
  status: "monitoring_no_open",
  provinces: [
    {
      code: "330000",
      label: "浙江省",
      status: "monitoring_no_open",
      monitoredRegionCodes: ["330100", "330109", "330200", "330212", "330400", "330500", "330600", "331100"],
      scopeNote:
        "浙江省来源近期检查正常，当前无在报岗位批次；「无在报」不等于当地没有招聘。省内其余城市暂未收录，「暂未收录」不代表当地没有招聘。",
    },
    {
      code: "320000",
      label: "江苏省",
      status: "monitoring_no_open",
      monitoredRegionCodes: ["320100", "320200", "320400", "320500"],
      scopeNote:
        "江苏省来源近期检查正常，当前无在报岗位批次；「无在报」不等于当地没有招聘。省内其余城市暂未收录，「暂未收录」不代表当地没有招聘。",
    },
    {
      code: "340000",
      label: "安徽省",
      status: "monitoring_no_open",
      monitoredRegionCodes: ["340300"],
      scopeNote:
        "安徽省来源近期检查正常，当前无在报岗位批次；「无在报」不等于当地没有招聘。省内其余城市暂未收录，「暂未收录」不代表当地没有招聘。",
    },
  ],
  regions: [
    region("330100", "浙江省·杭州市", "杭州市教育局"),
    region("330109", "浙江省·杭州市萧山区", "杭州市萧山区教育局"),
    region("330200", "浙江省·宁波市", "宁波市教育局"),
    region("330212", "浙江省·宁波市鄞州区", "宁波市鄞州区人民政府"),
    region("330400", "浙江省·嘉兴市", "嘉兴市教育局"),
    region("330500", "浙江省·湖州市", "湖州市教育局"),
    region("330600", "浙江省·绍兴市", "绍兴市教育局"),
    region("331100", "浙江省·丽水市", "丽水市教育局"),
    region("330000", "浙江省（省级）", "浙江省教育厅"),
    region("320100", "江苏省·南京市", "南京市教育局"),
    region("320400", "江苏省·常州市", "常州市教育局"),
    region("320500", "江苏省·苏州市", "苏州市教育局"),
    region("320200", "江苏省·无锡市", "无锡市教育局"),
    region("320000", "江苏省（省级）", "江苏省教育厅"),
    region("340300", "安徽省·蚌埠市", "蚌埠市教育局"),
  ],
  sources: ALL_SOURCES,
  lastCheckedAt: "2026-10-26T09:02:06.075Z",
  openOpportunityCount: 0,
  nextWindowNote:
    "各地招聘窗口以官方公告为准：本服务持续监测已登记来源，发现新公告后经人工审核发布，不预先承诺窗口时间。",
  scopeNote:
    "覆盖按官方来源台账与最近检查记录汇总：已登记/核验通过不代表已有在报岗位；近期检查正常指最近检查在新鲜窗口内且连续达标。未列出的省份均为「暂未收录」，「暂未收录」不代表当地没有招聘。",
  caliber: {
    generatedAt: "2026-10-26T09:05:49.593Z",
    version: "coverage-projection-2.0.0",
    registeredSources: 15,
    verifiedSources: 0,
    recentlyHealthySources: 11,
    failedSources: 0,
    pausedSources: 0,
    blockedSources: 2,
    publishedOpenUnits: 0,
    isFallback: true,
    fallbackNote: FALLBACK_NOTE,
  },
};
