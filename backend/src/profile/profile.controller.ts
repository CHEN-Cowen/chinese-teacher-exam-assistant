import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProfileService } from './profile.service.js';
import { UserGuard } from '../opportunities/user.guard.js';
import type { AuthenticatedRequest } from '../auth/identity.js';

/**
 * 用户画像读写（模块 8 + v7.2 PATCH）。
 * - GET  /profile 读取当前用户持久画像（未保存过返回 null）；
 * - PUT  /profile 幂等保存（登录迁移与完整修改走此接口，仅保留兼容）；
 * - PATCH /profile 白名单字段级部分更新 + updatedAt 乐观锁（v7.2 PRD 7.6.1）。
 * 全部按当前会话用户隔离，无法读取他人画像。
 */
@Controller('profile')
@UseGuards(UserGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    const row = await this.profileService.getProfileWithMeta(req.user!.id);
    return {
      profile: row.profile,
      ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    };
  }

  @Put()
  async save(
    @Req() req: AuthenticatedRequest,
    @Body() body: { profile?: unknown },
  ) {
    if (body.profile === undefined) {
      return { error: '缺少 profile 字段' };
    }
    await this.profileService.saveProfile(req.user!.id, body.profile);
    return { ok: true };
  }

  /**
   * v7.2 部分更新画像（PRD 7.6.1）+ R01 字段级扩展。
   * - 只接受白名单字段（birthDate, hukouProvinceCode, hukouCityCode,
   *   socialSecurityMonths, workExperienceMonths, extraAnswers,
   *   regions, employmentNaturePreference, educationExperiences, legacyEducation）；
   * - 只合并本次变化（partial merge），不是全量覆盖；
   * - expectedUpdatedAt 乐观锁，冲突由 service 抛 ConflictException（409）；
   * - 不做客户端读出全部画像后全量覆盖。
   */
  @Patch()
  @HttpCode(HttpStatus.OK)
  async patch(
    @Req() req: AuthenticatedRequest,
    @Body() body: { changes?: Record<string, unknown>; expectedUpdatedAt?: string },
  ) {
    if (!body.changes || typeof body.changes !== 'object') {
      return { error: '缺少 changes 字段' };
    }
    const result = await this.profileService.patchProfile(
      req.user!.id,
      body.changes,
      body.expectedUpdatedAt,
    );
    return {
      profile: result.profile,
      updatedAt: result.updatedAt,
    };
  }
}
