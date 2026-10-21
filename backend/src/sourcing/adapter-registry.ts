/**
 * v7.2 工作包 4：官网适配器注册表。
 *
 * 按来源登记中的 adapterKey 选择适配器；未知 key 视为配置错误，
 * 由调用方显式失败（不静默降级）。
 */
import { Injectable } from '@nestjs/common';
import type { OfficialSiteAdapter } from './official-site-adapter.js';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { NingboEducationAdapter } from './adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from './adapters/yinzhou-government.adapter.js';
import { NanjingEducationAdapter } from './adapters/nanjing-education.adapter.js';

@Injectable()
export class AdapterRegistry {
  private readonly byKey: Map<string, OfficialSiteAdapter>;

  constructor(
    hangzhou: HangzhouEducationAdapter,
    ningbo: NingboEducationAdapter,
    yinzhou: YinzhouGovernmentAdapter,
    nanjing: NanjingEducationAdapter,
  ) {
    const adapters = [hangzhou, ningbo, yinzhou, nanjing];
    this.byKey = new Map(adapters.map((adapter) => [adapter.key, adapter]));
  }

  get(key: string | null | undefined): OfficialSiteAdapter | null {
    if (!key) return null;
    return this.byKey.get(key) ?? null;
  }

  list(): OfficialSiteAdapter[] {
    return [...this.byKey.values()];
  }
}
