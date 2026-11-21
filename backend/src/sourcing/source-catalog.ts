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
/** 来源内容类型：招聘公告源或政策/通知源（默认招聘） */
export type SourceContentKind = 'recruitment' | 'policy';

export interface SourceCatalogEntry {
  sourceKey: string;
  publisher: string;
  regionCode: string;
  authorityLevel: SourceAuthorityLevel;
  /** 缺省为 recruitment；policy 源允许省级栏目，但不得计入市县招聘覆盖 */
  contentKind?: SourceContentKind;
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
    sourceKey: 'huzhou-education',
    publisher: '湖州市教育局',
    regionCode: '330500',
    authorityLevel: 'city',
    officialUrl: 'https://huedu.huzhou.gov.cn/',
    listUrls: ['https://huedu.huzhou.gov.cn/col/col1229210603/index.html'],
    allowedHosts: ['huedu.huzhou.gov.cn'],
    adapterKey: 'huzhou-education',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/huzhou',
    coverageNote:
      '「公示公告」栏目真实核验（2026-11-05）：jpaas 公开接口列表（表格行 + initJpage 分页）、正文 #zoom 与官方 xlsx 附件下载链接离线回放通过。该栏目为混合栏目，教师招聘相关条目需按标题判定；持续监测见检查记录。',
  },
  {
    sourceKey: 'taizhou-education',
    publisher: '泰州市教育局',
    regionCode: '321200',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.taizhou.gov.cn/',
    listUrls: ['https://jyj.taizhou.gov.cn/zxwj/index.html'],
    allowedHosts: ['jyj.taizhou.gov.cn'],
    adapterKey: 'taizhou-education',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/taizhou',
    coverageNote:
      '「最新文件」栏目真实核验（2026-11-05）：jpaas 公开接口列表（li + span 日期，title 占位符回退链接文本）、DOM 属性分页、正文 .content 与官方 xls 附件下载链接离线回放通过。该栏目为混合栏目，教师招聘相关条目需按标题判定；持续监测见检查记录。',
  },
  {
    sourceKey: 'bozhou-education',
    publisher: '亳州市人民政府',
    regionCode: '341600',
    authorityLevel: 'city',
    officialUrl: 'https://www.bozhou.gov.cn/',
    listUrls: [
      'https://www.bozhou.gov.cn/XxgkContent/showList/295/65767/page_1.html',
    ],
    allowedHosts: ['www.bozhou.gov.cn'],
    adapterKey: 'bozhou-education',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/bozhou',
    coverageNote:
      '「教师管理」栏目真实核验（2026-11-05）：服务端渲染静态列表（section.m-tglist）、pagination pagecount 分页（13 页 / 191 条）、正文 #zoom 与官方 /upload_bz/download 附件链接离线回放通过；含新任教师公开招聘、递补与拟聘用公示；持续监测见检查记录。',
  },
  {
    sourceKey: 'fuyang-education',
    publisher: '阜阳市教育局',
    regionCode: '341200',
    authorityLevel: 'city',
    officialUrl: 'https://edu.fy.gov.cn/',
    listUrls: ['https://edu.fy.gov.cn/Content/showList/843/page_1.html'],
    allowedHosts: ['edu.fy.gov.cn'],
    adapterKey: 'fuyang-education',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/fuyang',
    coverageNote:
      '「师资建设」栏目真实核验（2026-11-05）：服务端渲染静态列表（div.m-cglist.m-liststyle1）、pagination 分页（12 页 / 175 条）、正文 #zoom 与官方 /download?siteId= 附件链接离线回放通过；首屏含新任教师公开招聘成绩通知与选聘教师资格复审公告；跨站转载条目按详情路径过滤；持续监测见检查记录。',
  },
  {
    sourceKey: 'jinan-education',
    publisher: '济南市教育局',
    regionCode: '370100',
    authorityLevel: 'city',
    officialUrl: 'https://jnedu.jinan.gov.cn/',
    listUrls: ['https://jnedu.jinan.gov.cn/col/col19032/index.html'],
    allowedHosts: ['jnedu.jinan.gov.cn'],
    adapterKey: 'jinan-education',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/jinan',
    coverageNote:
      '「教师招聘专栏」真实核验（2026-11-05）：jpaas 公开接口列表（表格行 + td.bt_time 日期）、DOM 属性分页（6 页 / 79 条）、正文 #zoom 与官方 4 个岗位/材料附件下载链接离线回放通过；含 2027 届部属公费师范生招聘公告；持续监测见检查记录。',
  },
  {
    sourceKey: 'yantai-education',
    publisher: '烟台市教育局',
    regionCode: '370600',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.yantai.gov.cn/',
    listUrls: ['https://jyj.yantai.gov.cn/col/col17078/index.html'],
    allowedHosts: ['jyj.yantai.gov.cn'],
    adapterKey: 'yantai-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/yantai',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06）：jpaas 公开接口列表（li.cf + span.fr 日期）、DOM 属性分页（rows=15，官方总量 1365 条 / 91 页）；按单来源分页窗口只监测最新 6 页（90 条），窗口与原因见来源账本；列表内直链 PDF（年度报表、教辅目录等）不按公告正文抓取；正文 #zoom 与官方 xls 附件下载链接离线回放通过。该栏目为混合栏目，教师招聘相关条目需按标题判定；持续监测见检查记录。',
  },
  {
    sourceKey: 'taian-education',
    publisher: '泰安市教育局',
    regionCode: '370900',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.taian.gov.cn/',
    listUrls: ['https://jyj.taian.gov.cn/col/col45480/index.html'],
    allowedHosts: ['jyj.taian.gov.cn'],
    adapterKey: 'taian-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/taian',
    coverageNote:
      '「公示公告」混合栏目真实核验（2026-11-06）：首屏内嵌 datastore 45 条（官方总量 227 条 / 每页 15 条 / 共 16 页），后续页必须 POST application/x-www-form-urlencoded 到 /module/web/jpage/dataproxy.jsp（GET 返回空响应），按 13 个后续 POST 页补齐；正文标题/日期取官方 meta（ArticleTitle/pubdate），正文在 ContentStart/ContentEnd 标记之间，附件走 /module/download/downfile.jsp。站点为混合公告，教师招聘相关条目按标题判定；POST 请求体上限 4KB 且重定向后降级 GET；持续监测见检查记录。',
  },
  {
    sourceKey: 'weifang-education',
    publisher: '潍坊市教育局',
    regionCode: '370700',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.weifang.gov.cn/',
    listUrls: [
      'https://jyj.weifang.gov.cn/els-service/article/1/20?catas=trs1308521&dwid=55332&dq=162',
    ],
    allowedHosts: ['jyj.weifang.gov.cn'],
    adapterKey: 'weifang-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/weifang',
    coverageNote:
      '「公告公示」混合栏目（trs1308521）真实核验（2026-11-06）：列表页为 JS 壳，记录由 POST /els-service/article/{page}/{size} JSON 接口返回（官方 49 页 / 每页 20 条）；按单来源窗口只监测最新 6 页（约 120 条），窗口已登记（ELS_PAGE_WINDOWS）；列表/分页均为受限 JSON POST（≤4KB、固定模板、重定向降级 GET）；正文 meta ArticleTitle/PubDate + td#Content、附件 /upload-service/ 回放通过；无专属教师招聘栏目，混合栏目按标题判定形态；持续监测见检查记录。',
  },
  {
    sourceKey: 'nanchang-education',
    publisher: '南昌市教育局',
    regionCode: '360100',
    authorityLevel: 'city',
    officialUrl: 'https://edu.nc.gov.cn/',
    listUrls: ['https://edu.nc.gov.cn/ncjyj/jskfw/nav_list.shtml'],
    allowedHosts: ['edu.nc.gov.cn'],
    adapterKey: 'nanchang-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/nanchang',
    coverageNote:
      '「教师科发文」混合栏目真实核验（2026-11-06）：服务端渲染静态列表（ul.item li > a[title] + 同级 span 日期）、官方 createPageHTML 分页（2 页 / 34 条，nav_list_<n>.shtml）、正文官方 meta（ArticleTitle/PubDate）+ #zoom 与相对路径 <文章ID>/files/ 附件（xlsx/pdf/doc）离线回放通过；列表含跨栏目链接（/ncjyj/jszgrd/ 教师资格专栏），按详情路径放行；混合栏目，教师招聘相关条目按标题判定；持续监测见检查记录。',
  },
  {
    sourceKey: 'taiyuan-education',
    publisher: '太原市教育局',
    regionCode: '140100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.taiyuan.gov.cn/',
    listUrls: ['https://jyj.taiyuan.gov.cn/tzgg.html'],
    allowedHosts: ['jyj.taiyuan.gov.cn'],
    adapterKey: 'taiyuan-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/taiyuan',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06）：服务端渲染静态列表（ul.List_list li > span.fr 日期 + a[title]）、JS 跳转式分页（页码锚点 href="#" + onclick location.href，官方 93 条 / 5 页 / 每页 20 条，由 jsPaginationPages 解析）、正文官方 meta（ArticleTitle/PubDate）+ #zoom 与 /u/cms/site28/ 下 xlsx 附件离线回放通过；混合栏目，教师招聘相关条目按标题判定；持续监测见检查记录。',
  },
  {
    sourceKey: 'zhengzhou-education',
    publisher: '郑州市教育局',
    regionCode: '410100',
    authorityLevel: 'city',
    officialUrl: 'https://zzjy.zhengzhou.gov.cn/',
    // 老站 http 列表入口 + 新政务 https 详情域名（混合栏目双域名并存）
    listUrls: ['https://zzjy.zhengzhou.gov.cn/tzgg/index.jhtml'],
    allowedHosts: ['zzjy.zhengzhou.gov.cn', 'news.zzedu.net.cn'],
    adapterKey: 'zhengzhou-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/zhengzhou-education',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06，河南首个来源）：双域名并存——老站 http news.zzedu.net.cn/tz/ 静态列表（ul#pageCont a.new_link + M月D日 短日期），混合详情（.shtml 老站 SourceTitle + div#article / .jhtml 新政务 ArticleTitle + div.news_content_content）；JS 按钮"加载更多"分页（bfreeTools.js，首版只抓首屏 20 条）；含 10 条教师招聘/事业单位拟聘用公示（zzjy.zhengzhou.gov.cn/.jhtml），混合栏目按标题判定形态；持续监测见检查记录。',
  },
  {
    sourceKey: 'fuzhou-education',
    publisher: '福州市教育局',
    regionCode: '350100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.fuzhou.gov.cn/',
    // 列表数据接口 URL：query 承载全部 POST 请求体参数（channelid/chnlid/page），
    // 请求体由 fjdzSearchRequest 确定性派生；页面 URL /zwgk/tzgg/ 为 JS 壳不登记。
    listUrls: [
      'https://jyj.fuzhou.gov.cn/fjdzapp/search?channelid=229105&chnlid=47610&page=1',
    ],
    allowedHosts: ['jyj.fuzhou.gov.cn'],
    adapterKey: 'fuzhou-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/fuzhou-education',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06，福建首个来源）：列表页为 JS 壳，记录由 POST /fjdzapp/search 表单接口返回（官方 178 页 / 2658 条 / 每页 15 条），必须携带同源 Referer（缺 Referer 返回"获取站点配置失败"）；doctitle 检索参数不生效，按栏目全量翻页；按单来源分页窗口只监测最新 6 页（90 条），窗口已登记（FJ_PAGE_WINDOWS）；正文 meta ArticleTitle/PubDate + div.article_content、div.article_attachment 相对路径附件（P0…xlsx/pdf）回放通过；含招聘全周期公告（公告→补充→资格审核→面试→选岗→拟聘公示→递补），混合栏目按标题判定形态；持续监测见检查记录。',
  },
  {
    sourceKey: 'guangzhou-education',
    publisher: '广州市教育局',
    regionCode: '440100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.gz.gov.cn/',
    // 「网上公示」服务端渲染列表 + 静态锚点分页（index_N.html）；公告类通知另在
    // /yw/tzgg/，招聘密度低，首版只登记高价值的网上公示栏目。
    listUrls: ['https://jyj.gz.gov.cn/yw/wsgs/index.html'],
    allowedHosts: ['jyj.gz.gov.cn'],
    adapterKey: 'guangzhou-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/guangzhou-education',
    coverageNote:
      '「网上公示」栏目真实核验（2026-11-06，广东首个来源；NFCMS 集约化平台族）：服务端渲染列表 div.news_list li（a[title] + 方括号日期 [YYYY-MM-DD]），首屏 20 条、招聘密度高（首屏 4 条公开招聘教师/拟聘用公示，第 2 页 14/20）；分页为静态锚点 index_N.html（官方 20 页 / 400 条），页内 createPageHTML 声明已被注释失效（staticListPages 返回空，不能依赖），按单来源分页窗口只监测最新 6 页（120 条），窗口已登记（NFCMS_PAGE_WINDOWS）；正文 meta ArticleTitle/PubDate + div#zoomcon、/attachment/…xlsx 附件回放通过；持续监测见检查记录。',
  },
  {
    sourceKey: 'shijiazhuang-education',
    publisher: '石家庄市教育局',
    regionCode: '130100',
    authorityLevel: 'city',
    // 官方整站仅 HTTP（2026-11-06 实测 HTTPS 超时/socket hang up），
    // 已登记 HTTP_ONLY_HOSTS；不绕过，仅如实记录协议现实。
    officialUrl: 'http://sjzjyj.sjz.gov.cn/',
    listUrls: ['http://sjzjyj.sjz.gov.cn/a/zwgk/tzgg/index.html'],
    allowedHosts: ['sjzjyj.sjz.gov.cn'],
    adapterKey: 'shijiazhuang-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/shijiazhuang-education',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06，河北首个来源；PageFront 表单 POST 分页族）：服务端渲染列表 li.clearF > div.ul_zi > a（文章绝对地址 /a/YYYY/MM/DD/<id>.html）+ div.ul_ziriqi 日期，首屏 20 条；分页为 form[name=pageForm] POST /dynamic/PageFront.jsp（parseId/categoryId/keyword/pageNo），官方 6 页 / 120 条全量监测（窗口已登记 PAGEFRONT_PAGE_WINDOWS），POST 无 Referer 要求；混合栏目偶发微信公众号站外转载条目按详情路径过滤；正文 meta ArticleTitle（内嵌 <br> 清洗）/PubDate + div.content_fenye2，/resources/43/*.zip|docx 附件（nbsp 前缀剥离）与零附件条目回放通过；含公开招募银龄讲学教师公告，混合栏目按标题判定形态；持续监测见检查记录。',
  },
  {
    sourceKey: 'wuhan-education',
    publisher: '武汉市教育局',
    regionCode: '420100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.wuhan.gov.cn/',
    listUrls: ['https://jyj.wuhan.gov.cn/zwdt/tsgg/'],
    allowedHosts: ['jyj.wuhan.gov.cn'],
    adapterKey: 'wuhan-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/wuhan-education',
    coverageNote:
      '「通知公告」混合栏目真实核验（2026-11-06，湖北首个来源；navbox 静态锚点分页族）：目录形态栏目 /zwdt/tsgg/ 服务端渲染列表 li.box-sizing > a.item-li-a[title]（./YYYYMM/tYYYYMMDD_<id>.shtml）+ div.other（时间：YYYY-MM-DD），首屏 10 条；分页为 div#navbox 静态锚点 index_N.shtml（pagenav_tail 尾页给出官方 50 页 / 约 500 条 / 每页 10 条），按单来源分页窗口只监测最新 6 页（60 条），窗口已登记 WHSNAV_PAGE_WINDOWS，GET 无 Referer 要求；正文 meta ArticleTitle/PubDate/ContentSource + div#article-box（TRS_UEDITOR），./P0<数字>.pdf 附件（1 个 / 4 个多附件）与零附件条目回放通过；含直属单位公开招聘拟聘用公示与公费师范生专项招聘成绩公告，混合栏目按标题判定形态；持续监测见检查记录。',
  },
  {
    sourceKey: 'changsha-education',
    publisher: '长沙市教育局',
    regionCode: '430100',
    authorityLevel: 'city',
    // 官方整站仅 HTTP（2026-11-06 实测 HTTPS 握手失败 SSL alert 40），
    // 已登记 HTTP_ONLY_HOSTS；不绕过，仅如实记录协议现实。
    officialUrl: 'http://jyj.changsha.gov.cn/',
    listUrls: ['http://jyj.changsha.gov.cn/zfxxgk/fdzdgk/jszp/index.html'],
    allowedHosts: ['jyj.changsha.gov.cn'],
    adapterKey: 'changsha-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/changsha-education',
    coverageNote:
      '「教师招聘」栏目真实核验（2026-11-06，湖南首个来源；WCM createPageHTML5 静态分页族）：服务端渲染列表 div.xxgk-item li，锚点为嵌套 <a>（parse5 扁平化后外层锚点无标题，须取带 title 的内层锚点），日期在同级 span（YYYY-MM-DD），首屏 15 条；分页由官方脚本 createPageHTML5("8","0","index","html") 声明，族解析派生同目录 index_1..index_7.html（index.html 为第 1 页，官方 8 页 / 约 120 条全量监测，窗口已登记 WCM5_PAGE_WINDOWS），GET 无 Referer 要求；第 2 页 15 条中 1 条长沙市人社局（rsj.changsha.gov.cn）事业单位招考栏目跨站条目按同源过滤剔除，保留 14 条，与首屏重叠 1 条置顶公告（DETAIL_8787）；正文 meta ArticleTitle/Pubdate（官方 meta 名带前后空格，须 trim + 大小写不敏感匹配）+ div.content-main，./P0<数字>.pdf|xlsx|docx 附件（1 个 pdf / 3 个附件 xlsx+2 docx / 7 个附件 5 pdf+2 docx）与零附件条目离线回放通过；持续监测见检查记录。',
  },
  {
    sourceKey: 'guiyang-education',
    publisher: '贵阳市教育局',
    regionCode: '520100',
    authorityLevel: 'city',
    officialUrl: 'https://jyj.guiyang.gov.cn/',
    listUrls: ['https://jyj.guiyang.gov.cn/newsite/zwgk/zdlyxxgk/jsgz/'],
    allowedHosts: ['jyj.guiyang.gov.cn'],
    adapterKey: 'guiyang-education',
    status: 'ready',
    verifiedAt: '2026-11-06',
    sampleRef: 'tests/fixtures/golden-sources/guiyang-education',
    coverageNote:
      '「教师工作」栏目真实核验（2026-11-06，贵州首个来源；WCM createPage 4 参静态分页族）：目录形态栏目 /newsite/zwgk/zdlyxxgk/jsgz/（政务公开 > 重点领域信息公开）服务端渲染 ul.right-cont_list li > a[href][title][target=_blank]，锚点内 <p> 标题 + <span> 日期 YYYY-MM-DD，首屏 15 条；分页由官方脚本 createPage(19,0,"index","html") 声明（WCM 4 参数裸调用，无 wcmUtil. 前缀），族解析派生同目录 index_1..index_18.html（官方 19 页 / 277 条全量监测，窗口已登记 WCM5_PAGE_WINDOWS），GET 无 Referer 要求；第 2 页 15 条与首屏 0 重叠；栏目为教师招聘密集栏目（公费师范生招聘/试教成绩、人才引进拟聘用、教师公开招聘拟聘用），按标题判定文档形态；正文 meta ArticleTitle/PubDate（标准名无空格，值带时分 YYYY-MM-DD HH:mm）/ContentSource + div.TRS_UEDITOR，./P0<数字>.pdf|xls|xlsx|doc|docx 附件（1 pdf / 4 附件 xlsx+xls+docx+xlsx / 2 附件 xls+doc）与零附件条目离线回放通过；持续监测见检查记录。',
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
  {
    sourceKey: 'anhui-education-policy',
    publisher: '安徽省教育厅',
    regionCode: '340000',
    authorityLevel: 'province',
    contentKind: 'policy',
    officialUrl: 'https://jyt.ah.gov.cn/',
    listUrls: ['https://jyt.ah.gov.cn/xwzx/tzgg/index.html'],
    allowedHosts: ['jyt.ah.gov.cn'],
    adapterKey: 'anhui-education-policy',
    status: 'ready',
    verifiedAt: '2026-11-05',
    sampleRef: 'tests/fixtures/golden-sources/anhui-policy',
    coverageNote:
      '省级教育政策/通知来源（2026-11-05 真实首屏与正文回放）：服务端渲染列表 + meta/ArticleTitle + .j-fontContent 正文；只用于安徽省级政策检索，不代表省市县教师招聘覆盖，不能替代市级公告来源。',
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

/**
 * 官方整站仅 HTTP 的已登记宿主（无 HTTPS 服务，实测连接超时/拒绝）。
 * 只对这些宿主放行 http:// 入口；登记必须附实测证据（见各条目 coverageNote）。
 * 这不是绕过安全策略：SafeFetcher 仍执行 DNS/重定向/大小/并发全部限制，
 * 仅如实记录国内部分老政务站点尚未提供 HTTPS 的现实。
 */
export const HTTP_ONLY_HOSTS: ReadonlySet<string> = new Set([
  'sjzjyj.sjz.gov.cn',
  'jyj.changsha.gov.cn',
]);

/**
 * 来源目录规模护栏。N3 跨省扩源按批次持续新增（2026-11-06 已达 30 个），
 * 上限从 S5 阶段的 30 放开到 60 以留出扩源余量；下限与上限仍用于防止
 * 目录被误删或异常膨胀，不是业务目标值。
 */
export const MIN_CATALOG_SIZE = 10;
export const MAX_CATALOG_SIZE = 60;

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
    // 省级教育部门通常不发布市县教师招聘公告；招聘类省级来源不得挂栏目列表，
    // 更不得用来代表所辖市县覆盖（见 S0 规范）。政策类来源允许省级栏目。
    if (
      entry.authorityLevel === 'province' &&
      entry.listUrls.length > 0 &&
      entry.contentKind !== 'policy'
    ) {
      errors.push(`省级招聘来源不得登记栏目列表: ${entry.sourceKey}`);
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
        // 官方仅 HTTP 的已登记宿主放行 http 入口（见 HTTP_ONLY_HOSTS）；
        // 其余来源仍强制 HTTPS。
        const protocolOk =
          parsed.protocol === 'https:' ||
          (parsed.protocol === 'http:' && HTTP_ONLY_HOSTS.has(parsed.hostname));
        if (
          !protocolOk ||
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
  if (catalog.length < MIN_CATALOG_SIZE || catalog.length > MAX_CATALOG_SIZE) {
    errors.push(
      `S5 来源数量应为 ${MIN_CATALOG_SIZE}-${MAX_CATALOG_SIZE}，当前为 ${catalog.length}`,
    );
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
  {
    sourceKey: 'anhui-education-policy',
    checks: [
      {
        checkedAt: '2026-11-05T08:50:29.419Z',
        outcome: 'succeeded',
        discoveredCount: 32,
        contentHash: null,
        note: 'W5 首次真实采样：安徽省教育厅通知公告首屏 HTTP 200，32 条服务端渲染条目；正文 meta/ArticleTitle、PubDate 与 .j-fontContent 回放通过。',
      },
      {
        checkedAt: '2026-11-05T08:53:30.774Z',
        outcome: 'no_new',
        discoveredCount: 32,
        contentHash:
          '60d5514d6cb330f0a4f3264aa2f1fb1eea40838a63bd21029a2ed8bf0913326a',
        note: 'W5 第二次真实采样（距首次约 3 分钟）：栏目 HTTP 200，32 条标题/日期/链接与首次样本一致；指纹为条目字段 sha256。',
      },
    ],
  },
  {
    sourceKey: 'huzhou-education',
    checks: [
      {
        checkedAt: '2026-11-05T15:20:44.363Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N1 首次真实采样：栏目外壳 + 同源 jpaas 公开接口列表首屏 HTTP 200，解析 15 条；initJpage rows=15/count=41（共 3 页）；正文 #zoom 与官方 xlsx 附件下载链接离线回放通过。',
      },
      {
        checkedAt: '2026-11-05T15:30:14.807Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          'e571e2ed712d1bdfd09e376cc522400aa19696507d1709b155cb3d27581e7e3f',
        note: 'N1 第二次真实采样（距首次约 9.5 分钟）：公开列表 15 条标题/日期/链接与首次样本完全一致；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'taizhou-education',
    checks: [
      {
        checkedAt: '2026-11-05T15:20:46.630Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N1 首次真实采样：栏目外壳 + 同源 jpaas 公开接口列表首屏 HTTP 200，解析 15 条（title 占位符回退链接文本）；DOM 属性 rows=15/count=30（共 2 页）；正文 .content 与官方 xls 附件下载链接离线回放通过。',
      },
      {
        checkedAt: '2026-11-05T15:30:15.593Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          '470c9faa5610f1a48a0cfc3a3f04854f735ecc7bfc0a984df0673f0ce1e62074',
        note: 'N1 第二次真实采样（距首次约 9.5 分钟）：公开列表 15 条标题/日期/链接与首次样本完全一致；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'bozhou-education',
    checks: [
      {
        checkedAt: '2026-11-05T15:20:53.703Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N1 首次真实采样：教师管理栏目首屏 HTTP 200，解析 15 条服务端渲染条目；pagination pagecount=13（共 13 页 / 191 条）；正文 #zoom 与官方 /upload_bz/download 附件链接离线回放通过。',
      },
      {
        checkedAt: '2026-11-05T15:30:16.344Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          '1121e3fdb87209b40cbf90504548402b8a54372d3cfded6078453d74a30d9e0c',
        note: 'N1 第二次真实采样（距首次约 9.5 分钟）：列表 15 条标题/日期/链接与首次样本完全一致；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'fuyang-education',
    checks: [
      {
        checkedAt: '2026-11-05T15:54:03.976Z',
        outcome: 'succeeded',
        discoveredCount: 10,
        contentHash: null,
        note: 'N1 首次真实采样：师资建设栏目首屏 HTTP 200，15 条中 10 条为本域 /Content/show/ 详情（5 条跨站转载按路径过滤）；pagination pagecount=12（共 12 页 / 175 条）；正文 #zoom 与官方 /download?siteId= 附件链接离线回放通过。',
      },
      {
        checkedAt: '2026-11-05T15:55:12.318Z',
        outcome: 'no_new',
        discoveredCount: 10,
        contentHash:
          '89f12b18de0d87ccea7fd1283ff10204fe827d244ff0dbd3e5de6c790b7051b5',
        note: 'N1 第二次真实采样（距首次约 1 分钟）：本域 10 条标题/日期/链接与首次样本完全一致；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'jinan-education',
    checks: [
      {
        checkedAt: '2026-11-05T16:17:30.985Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N2 首次真实采样：教师招聘专栏外壳 + 同源 jpaas 公开接口列表首屏 HTTP 200，解析 15 条；DOM 属性 rows=15/count=79（共 6 页）；正文 #zoom 与 4 个官方 jpaas 附件下载链接离线回放通过。',
      },
      {
        checkedAt: '2026-11-05T16:20:09.050Z',
        outcome: 'no_new',
        discoveredCount: 15,
        contentHash:
          '7942b9435f8cf4494346473d2f0db94abd2075e3f6b3442b62d33b5400bb2081',
        note: 'N2 第二次真实采样（距首次约 2.5 分钟）：公开列表 15 条标题/日期/链接与首次样本完全一致；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'yantai-education',
    checks: [
      {
        checkedAt: '2026-11-06T01:08:05.494Z',
        outcome: 'succeeded',
        discoveredCount: 12,
        contentHash: null,
        note: 'N2 首次真实采样：通知公告外壳 + 同源 jpaas 公开接口列表首屏 HTTP 200，解析 12 条官方文章页（首屏 15 行中 3 条为 PDF 附件，未按正文抓取）；DOM 属性 rows=15/count=1365（共 91 页），按单来源窗口只监测最新 6 页（90 条）；正文 #zoom、官方 meta 与 xls 附件下载链接离线回放通过。7 天持续观察窗口尚未完成。',
      },
      {
        checkedAt: '2026-11-06T01:09:11.400Z',
        outcome: 'no_new',
        discoveredCount: 12,
        contentHash:
          '7a4b2c2dcb6f95f0b7725c542755c9370f9b056bb7eae01f65c806bfba15ba91',
        note: 'N2 第二次真实采样（距首次约 1 分钟）：列表 HTTP 200，12 条标题/日期/链接与首次样本完全一致，第 2 页 15 条与首屏无重叠；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'taian-education',
    checks: [
      {
        checkedAt: '2026-11-06T01:53:26.910Z',
        outcome: 'succeeded',
        discoveredCount: 45,
        contentHash: null,
        note: 'N2 首次真实采样：公示公告首屏 HTTP 200，datastore 解析 45 条（官方总量 227 / 每页 15 / 16 页）；POST dataproxy startrecord=46 返回 46 条且与首屏无重叠；正文 ContentStart/ContentEnd 与附件下载离线回放通过。7 天持续观察窗口尚未完成。',
      },
      {
        checkedAt: '2026-11-06T01:54:34.111Z',
        outcome: 'no_new',
        discoveredCount: 45,
        contentHash:
          '09cdc350c74f1a1dca2f511317d1161905ceab603b5945c7ecec690ce5148e7d',
        note: 'N2 第二次真实采样（距首次约 1 分钟）：首屏 45 条标题/日期/链接与首次一致；POST 第 46 条起仍为 46 条且与首屏无重叠；指纹为条目字段 sha256。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'weifang-education',
    checks: [
      {
        checkedAt: '2026-11-06T02:57:47.297Z',
        outcome: 'succeeded',
        discoveredCount: 20,
        contentHash: null,
        note: 'N2 首次真实采样：POST /els-service/article/1/20 返回公告公示第 1 页 20 条（官方 49 页 / 每页 20 条）；第 2 页与首屏无重叠；正文 meta + td#Content 与 /upload-service/ 附件离线回放通过。7 天持续观察窗口尚未完成。',
      },
      {
        checkedAt: '2026-11-06T02:58:18.037Z',
        outcome: 'no_new',
        discoveredCount: 20,
        contentHash:
          '1ea4bb4e9e35b51ce435512b014dde3f4896136e469208a21b342317e87fccc4',
        note: 'N2 第二次真实采样（距首次约 31 秒）：第 1 页 20 条标题/日期/链接与首次一致，指纹（日期|标题|URL 行 sha256）相同；7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'nanchang-education',
    checks: [
      {
        checkedAt: '2026-11-06T03:59:14.704Z',
        outcome: 'succeeded',
        discoveredCount: 25,
        contentHash: null,
        note: 'N3 首次真实采样：教师科栏目首屏 25 条（含 1 条跨栏目 /ncjyj/jszgrd/ 链接）；createPageHTML 声明 2 页 / 34 条，第 2 页 9 条与首屏无重叠；正文官方 meta + #zoom 与相对路径附件（xlsx/pdf/doc）离线回放通过。7 天持续观察窗口尚未完成。',
      },
      {
        checkedAt: '2026-11-06T04:07:36.596Z',
        outcome: 'no_new',
        discoveredCount: 25,
        contentHash:
          '6a661c54ccea5c4323fa0e4fb6d07a57e9a91955746575a819ff507ecded3b9b',
        note: 'N3 第二次真实采样（距首次约 8 分钟）：首屏 25 条标题/日期/链接与首次一致，指纹（日期|标题|URL 行 sha256）相同；7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'taiyuan-education',
    checks: [
      {
        checkedAt: '2026-11-06T05:55:17.588Z',
        outcome: 'succeeded',
        discoveredCount: 20,
        contentHash: null,
        note: 'N3 首次真实采样：通知公告栏目首屏 20 条；JS 跳转分页声明共 93 条 / 5 页，第 2 页 20 条与首屏无重叠；正文官方 meta + #zoom 与 /u/cms/site28/ 下 xlsx 附件离线回放通过。7 天持续观察窗口尚未完成。',
      },
      {
        checkedAt: '2026-11-06T05:56:40.153Z',
        outcome: 'no_new',
        discoveredCount: 20,
        contentHash:
          'be53f87ef2978a423bf4a204f9ce73332c556ae03d1c70058dac0537b22ad495',
        note: 'N3 第二次真实采样（距首次约 83 秒）：首屏 20 条标题/日期/链接与首次一致，指纹（日期|标题|URL 行 sha256）相同；7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'zhengzhou-education',
    checks: [
      {
        checkedAt: '2026-11-06T06:30:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 20,
        contentHash: null,
        note: 'N3 首次真实采样（河南首个来源）：老站 http news.zzedu.net.cn/tz/ 通知公告混合栏目首屏 20 条（10 条老站 .shtml + 10 条新政务 .jhtml）；JS 按钮"加载更多"分页（pageTotal=7），首版只抓首屏；双域名详情回放通过——.shtml 老站 SourceTitle + div#article、.jhtml 新政务 ArticleTitle + div.news_content_content + xlsx 附件下载。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'fuzhou-education',
    checks: [
      {
        checkedAt: '2026-11-06T09:18:48.000Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N3 首次真实采样（福建首个来源）：通知公告混合栏目 POST /fjdzapp/search 表单接口首屏 HTTP 200，解析 15 条（官方 178 页 / 2658 条 / 每页 15 条，必须携带同源 Referer）；按单来源窗口只监测最新 6 页（90 条），第 2 页 15 条与首屏无重叠且首条即拟聘公示；正文 meta ArticleTitle/PubDate + div.article_content 与 div.article_attachment 相对路径附件（P0…xlsx/pdf）离线回放通过。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'guangzhou-education',
    checks: [
      {
        checkedAt: '2026-11-06T10:26:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 20,
        contentHash: null,
        note: 'N3 首次真实采样（广东首个来源；NFCMS 集约化平台族）：网上公示栏目服务端渲染列表首屏 HTTP 200，解析 20 条（方括号日期 [YYYY-MM-DD]）；分页为静态锚点 index_2..index_20.html（官方 20 页 / 400 条），页内 createPageHTML 声明已被注释失效，改由 nfcmsIndexPages 派生并按窗口只监测最新 6 页（120 条）；第 2 页 20 条与首屏无重叠、招聘密度 14/20；正文 meta ArticleTitle/PubDate + div#zoomcon 与 /attachment/…xlsx 附件离线回放通过。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'shijiazhuang-education',
    checks: [
      {
        checkedAt: '2026-11-06T11:20:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 20,
        contentHash: null,
        note: 'N3 首次真实采样（河北首个来源；PageFront 表单 POST 分页族；官方整站仅 HTTP，HTTPS 实测超时已登记 HTTP_ONLY_HOSTS）：通知公告混合栏目首屏 HTTP 200，解析 20 条（li.clearF > div.ul_zi + div.ul_ziriqi 日期）；分页为 form[name=pageForm] POST /dynamic/PageFront.jsp（parseId/categoryId/keyword/pageNo，官方 6 页 / 120 条全量监测，无 Referer 要求），POST 第 2 页 20 行中 2 条微信公众号站外转载按详情路径过滤、18 条与首屏无重叠；正文 meta ArticleTitle（内嵌 <br> 清洗）/PubDate + div.content_fenye2，/resources/43/*.zip|docx 附件（3 zip / 2 docx 招聘相关）与零附件条目离线回放通过。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'wuhan-education',
    checks: [
      {
        checkedAt: '2026-11-06T12:05:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 10,
        contentHash: null,
        note: 'N3 首次真实采样（湖北首个来源；navbox 静态锚点分页族）：通知公告混合栏目目录页 /zwdt/tsgg/ 首屏 HTTP 200，解析 10 条（li.box-sizing > a.item-li-a[title] + div.other 时间：YYYY-MM-DD）；分页为 div#navbox 静态锚点 index_N.shtml（pagenav_tail 尾页 index_49，官方 50 页 / 约 500 条 / 每页 10 条），按单来源窗口只监测最新 6 页（60 条），GET 无 Referer 要求；第 2 页（index_1.shtml）10 条与首屏无重叠且含直属单位招聘面试资格复审公告；正文 meta ArticleTitle/PubDate/ContentSource + div#article-box（TRS_UEDITOR），./P0<数字>.pdf 附件（拟聘用公示 1 个 / 资格认定 4 个多附件 / 公费师范生招聘成绩 1 个）与零附件条目离线回放通过。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'changsha-education',
    checks: [
      {
        checkedAt: '2026-11-06T13:10:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N3 首次真实采样（湖南首个来源；WCM createPageHTML5 静态分页族；官方整站仅 HTTP，HTTPS 实测握手失败 SSL alert 40 已登记 HTTP_ONLY_HOSTS）：教师招聘栏目 /zfxxgk/fdzdgk/jszp/index.html 首屏 HTTP 200，解析 15 条（div.xxgk-item li，嵌套 <a> 经 parse5 扁平化后须取带 title 的内层锚点 + span 日期 YYYY-MM-DD）；分页由官方脚本 createPageHTML5("8","0","index","html") 声明，族解析派生 index_1..index_7.html（官方 8 页 / 约 120 条全量监测，窗口登记 WCM5_PAGE_WINDOWS）；第 2 页 15 条中 1 条长沙市人社局 rsj.changsha.gov.cn 跨站招考条目按同源过滤剔除、保留 14 条，与首屏重叠 1 条置顶公告；正文 meta ArticleTitle/Pubdate（meta 名带空格须 trim、大小写不敏感）+ div.content-main，附件（1 pdf / 3 附件 xlsx+2 docx / 7 附件 5 pdf+2 docx）与零附件条目离线回放通过。7 天持续观察窗口尚未完成。',
      },
    ],
  },
  {
    sourceKey: 'guiyang-education',
    checks: [
      {
        checkedAt: '2026-11-06T14:40:00.000Z',
        outcome: 'succeeded',
        discoveredCount: 15,
        contentHash: null,
        note: 'N3 首次真实采样（贵州首个来源；WCM createPage 4 参静态分页族）：教师工作栏目 /newsite/zwgk/zdlyxxgk/jsgz/ 首屏 HTTPS 200（311ms），解析 15 条（ul.right-cont_list li > a[href][title]，锚点内 <p> 标题 + <span> 日期 YYYY-MM-DD）；分页由官方脚本 createPage(19,0,"index","html") 声明（官方 19 页 / 277 条全量监测，窗口登记 WCM5_PAGE_WINDOWS），第 2 页 index_1.html 15 条与首屏 0 重叠；正文 meta ArticleTitle/PubDate（标准名无空格，值带时分）/ContentSource + div.TRS_UEDITOR，附件（试教成绩 1 pdf / 公费师范生招聘公告 4 附件 xlsx+xls+docx+xlsx / 面试公告 2 附件 xls+doc）与零附件拟聘用公示离线回放通过。7 天持续观察窗口尚未完成。',
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
