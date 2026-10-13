import { Module } from '@nestjs/common';
import { HangzhouEducationAdapter } from './adapters/hangzhou-education.adapter.js';

/**
 * 主动抓取来源模块（v7.2 工作包 3 子集）。
 *
 * 本工作包只交付单来源 Adapter 与稳定的来源标识；SafeFetcher 是纯构造函数
 * （依赖注入的 DNS/fetch），按需在调用侧装配，避免在无抓取任务时创建长驻资源。
 */
@Module({
  providers: [HangzhouEducationAdapter],
  exports: [HangzhouEducationAdapter],
})
export class SourcingModule {}
