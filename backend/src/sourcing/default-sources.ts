/**
 * v7.2 工作包 4 / S4：首批四个官方来源的登记数据。
 *
 * 只登记“来源 → 适配器”的静态配置（域名、适配器键、轮询周期），
 * 不含任何解析逻辑（解析逻辑在 adapters/*.adapter.ts，且必须是纯函数）。
 *
 * 说明：栏目页/详情页的具体 URL 路径属于**运维配置**，必须对照真实官网核对后
 * 再填入 `listUrls`；本文件给出的域名是真实官方域名，路径留待核对，
 * 以避免把未经核对的示意路径当作抓取目标（见 tests 黄金样本 README）。
 */
import { HANGZHOU_ADAPTER_KEY } from './adapters/hangzhou-education.adapter.js';
import { NINGBO_ADAPTER_KEY } from './adapters/ningbo-education.adapter.js';
import { YINZHOU_ADAPTER_KEY } from './adapters/yinzhou-government.adapter.js';
import { NANJING_ADAPTER_KEY } from './adapters/nanjing-education.adapter.js';

export interface DefaultCrawlSource {
  adapterKey: string;
  publisher: string;
  regionCode: string;
  officialUrl: string;
  /** 栏目列表页入口；为空表示使用 officialUrl（须先核对真实栏目路径） */
  listUrls: string[];
  allowedHosts: string[];
  pollEveryMinutes: number;
}

export const DEFAULT_CRAWL_SOURCES: readonly DefaultCrawlSource[] = [
  {
    adapterKey: NANJING_ADAPTER_KEY,
    publisher: '南京市教育局',
    regionCode: '320100',
    officialUrl: 'https://edu.nanjing.gov.cn/bsfw/zpzk/',
    // 教师招聘栏目列表页 + 分页（index_1 为第 2 页，含 2026-01 各区公告）。
    // 栏目路径已对照真实官网核实（2026-10-21）。
    listUrls: [
      'https://edu.nanjing.gov.cn/bsfw/zpzk/index.html',
      'https://edu.nanjing.gov.cn/bsfw/zpzk/index_1.html',
    ],
    allowedHosts: ['edu.nanjing.gov.cn'],
    pollEveryMinutes: 60,
  },
  {
    adapterKey: HANGZHOU_ADAPTER_KEY,
    publisher: '杭州市教育局',
    regionCode: '330100',
    officialUrl: 'https://edu.hangzhou.gov.cn/',
    // S5 真实核验（2026-10-26）：「教师招聘」专栏外壳页声明同源 jpaas 公开列表接口，
    // 列表与正文均已离线回放通过；具体栏目路径已对照真实官网核实。
    listUrls: ['https://edu.hangzhou.gov.cn/col/col1228921906/index.html'],
    allowedHosts: ['edu.hangzhou.gov.cn'],
    pollEveryMinutes: 60,
  },
  {
    adapterKey: NINGBO_ADAPTER_KEY,
    publisher: '宁波市教育局',
    regionCode: '330200',
    officialUrl: 'https://jyj.ningbo.gov.cn/',
    // S4 核实入口；动态 AuthorizedRead 列表尚待适配，200 不代表发现成功。
    listUrls: [
      'https://jyj.ningbo.gov.cn/col/col1229166692/index.html?number=',
    ],
    allowedHosts: ['jyj.ningbo.gov.cn'],
    pollEveryMinutes: 60,
  },
  {
    adapterKey: YINZHOU_ADAPTER_KEY,
    publisher: '宁波市鄞州区人民政府',
    regionCode: '330212',
    officialUrl: 'https://www.nbyz.gov.cn/',
    // S4 核实入口；动态 AuthorizedRead 列表尚待适配，不能标为正常监测。
    listUrls: ['https://www.nbyz.gov.cn/col/col1229108032/jszp/index.html'],
    allowedHosts: ['www.nbyz.gov.cn'],
    pollEveryMinutes: 60,
  },
];
