import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import {
  inferStageFromText,
  resolveSubject,
  subjectOptions,
  SUBJECTS,
} from './subject-catalog.js';

/**
 * 全学科字典接口（W1）。
 *
 * - GET /subjects：稳定代码 + 展示名 + 分类 + 支持学段；
 * - GET /subjects/resolve：把官方学科原文解析为代码，歧义/未知如实返回，
 *   供导入与审核流程复用（不在这里自动猜测）。
 *
 * 只读、无用户数据，列入会话守卫公开路径。
 */
@Controller('subjects')
export class SubjectsController {
  @Get()
  list() {
    return {
      items: subjectOptions(),
      total: SUBJECTS.filter((s) => s.enabled).length,
    };
  }

  @Get('resolve')
  resolve(@Query('name') name?: string, @Query('stage') stage?: string) {
    const raw = typeof name === 'string' ? name.trim() : '';
    if (!raw) throw new BadRequestException('缺少学科原文 name');
    if (raw.length > 100) throw new BadRequestException('学科原文过长');
    const resolution = resolveSubject(raw, { stage });
    return {
      ...resolution,
      inferredStage: inferStageFromText(raw) ?? resolution.stage ?? null,
    };
  }
}
