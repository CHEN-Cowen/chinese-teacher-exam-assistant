/**
 * v7.2 工作包 4：官网适配器注册表。
 *
 * 按来源登记中的 adapterKey 选择适配器；未知 key 视为配置错误，
 * 由调用方显式失败（不静默降级）。
 */
import { Injectable } from '@nestjs/common';
import type { OfficialSiteAdapter } from './official-site-adapter.js';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';
import { LishuiEducationAdapter } from './adapters/lishui-education.adapter.js';
import { NingboEducationAdapter } from './adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from './adapters/yinzhou-government.adapter.js';
import { NanjingEducationAdapter } from './adapters/nanjing-education.adapter.js';
import { ShaoxingEducationAdapter } from './adapters/shaoxing-education.adapter.js';
import { JiaxingEducationAdapter } from './adapters/jiaxing-education.adapter.js';
import { SuzhouEducationAdapter } from './adapters/suzhou-education.adapter.js';
import { ChangzhouEducationAdapter } from './adapters/changzhou-education.adapter.js';
import { BengbuEducationAdapter } from './adapters/bengbu-education.adapter.js';
import { XiaoshanEducationAdapter } from './adapters/xiaoshan-education.adapter.js';

/** 过滤掉未注入的可选适配器（保持类型收窄） */
function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

@Injectable()
export class AdapterRegistry {
  private readonly byKey: Map<string, OfficialSiteAdapter>;

  constructor(
    hangzhou: HangzhouEducationAdapter,
    ningbo: NingboEducationAdapter,
    yinzhou: YinzhouGovernmentAdapter,
    nanjing: NanjingEducationAdapter,
    shaoxing: ShaoxingEducationAdapter,
    jiaxing: JiaxingEducationAdapter,
    suzhou: SuzhouEducationAdapter,
    changzhou: ChangzhouEducationAdapter,
    lishui: LishuiEducationAdapter,
    // 新适配器一律追加到末尾，且保持**可选**：
    // 既有测试按位置传前 9 个适配器，新增参数不能让它们变成 undefined。
    bengbu?: BengbuEducationAdapter,
    xiaoshan?: XiaoshanEducationAdapter,
  ) {
    const adapters: OfficialSiteAdapter[] = [
      hangzhou,
      ningbo,
      yinzhou,
      nanjing,
      shaoxing,
      jiaxing,
      suzhou,
      changzhou,
      lishui,
      bengbu,
      xiaoshan,
    ].filter(defined);
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
