/**
 * v7.2 工作包 4：首批三个官方来源的登记数据。
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
    adapterKey: HANGZHOU_ADAPTER_KEY,
    publisher: '杭州市教育局',
    regionCode: '330100',
    officialUrl: 'https://edu.hangzhou.gov.cn/',
    listUrls: [],
    allowedHosts: ['edu.hangzhou.gov.cn'],
    pollEveryMinutes: 60,
  },
  {
    adapterKey: NINGBO_ADAPTER_KEY,
    publisher: '宁波市教育局',
    regionCode: '330200',
    officialUrl: 'https://jyj.ningbo.gov.cn/',
    listUrls: [],
    allowedHosts: ['jyj.ningbo.gov.cn'],
    pollEveryMinutes: 60,
  },
  {
    adapterKey: YINZHOU_ADAPTER_KEY,
    publisher: '宁波市鄞州区人民政府',
    regionCode: '330212',
    officialUrl: 'https://www.nbyz.gov.cn/',
    listUrls: [],
    allowedHosts: ['www.nbyz.gov.cn'],
    pollEveryMinutes: 60,
  },
];
