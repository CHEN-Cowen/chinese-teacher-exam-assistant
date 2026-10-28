import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  normalizeEducationExperiences,
  validateEducationExperiences,
} from '../matching/education.js';

/**
 * 用户基础画像服务（模块 8 + v7.2 PATCH）。
 * 画像以 JSON 整体 upsert，不做字段级拆分；匹配接口按需读取。
 * 不保存身份证号、社保账号等敏感信息。
 *
 * v7.2 新增 patchProfile：白名单字段级部分更新 + updatedAt 乐观锁。
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<unknown> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    return row?.profile ?? null;
  }

  /**
   * v7.2 读取画像含 updatedAt（乐观锁用）。
   * 未保存过返回 { profile: null, updatedAt: undefined }。
   */
  async getProfileWithMeta(userId: string): Promise<{
    profile: unknown;
    updatedAt: string | undefined;
  }> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!row) return { profile: null, updatedAt: undefined };
    return {
      profile: row.profile,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 幂等保存：同用户重复 PUT 只更新一条记录，不产生重复 */
  async saveProfile(userId: string, profile: unknown): Promise<void> {
    const normalized = this.normalizeProfileEducation(profile);
    await this.prisma.userProfile.upsert({
      where: { userId },
      update: { profile: normalized as never },
      create: { userId, profile: normalized as never },
    });
  }

  /**
   * D01：分阶段教育经历在服务端规整并校验。
   * - 只处理 educationExperiences，不改旧单一字段原值；
   * - 结构非法直接 400，不静默丢数据；
   * - 未提供该字段的旧画像原样保存。
   */
  private normalizeProfileEducation(profile: unknown): unknown {
    if (
      typeof profile !== 'object' ||
      profile === null ||
      Array.isArray(profile)
    ) {
      return profile;
    }
    const record = profile as Record<string, unknown>;
    if (!('educationExperiences' in record)) return profile;
    if (!Array.isArray(record.educationExperiences)) {
      throw new BadRequestException({
        error: 'INVALID_EDUCATION_EXPERIENCES',
        message: '教育经历必须是数组',
      });
    }
    const experiences = normalizeEducationExperiences(
      record.educationExperiences,
    );
    if (experiences.length !== record.educationExperiences.length) {
      throw new BadRequestException({
        error: 'INVALID_EDUCATION_EXPERIENCES',
        message: '存在结构不完整或阶段不合法的教育经历',
      });
    }
    const issues = validateEducationExperiences(experiences);
    if (issues.length > 0) {
      throw new BadRequestException({
        error: 'INVALID_EDUCATION_EXPERIENCES',
        message: issues[0].message,
        issues,
      });
    }
    return { ...record, educationExperiences: experiences };
  }

  /**
   * v7.2 白名单字段（PRD 7.6.1）。
   * 只允许条件画像字段，不允许修改基础画像（地区/学历/专业/教资）。
   * 基础画像修改走 onboarding（动作分流：修改全部信息 → onboarding）。
   */
  static readonly PATCH_WHITELIST = [
    'birthDate',
    'hukouProvinceCode',
    'hukouCityCode',
    'socialSecurityMonths',
    'workExperienceMonths',
    'extraAnswers',
  ] as const;

  /**
   * 过滤 changes，只保留白名单字段。
   */
  private filterWhitelist(
    changes: Record<string, unknown>,
  ): Record<string, unknown> {
    const allowed: Record<string, unknown> = {};
    for (const key of ProfileService.PATCH_WHITELIST) {
      if (key in changes) {
        allowed[key] = changes[key];
      }
    }
    return allowed;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * v7.2 部分更新画像（PRD 7.6.1）。
   * - 只接受白名单字段；
   * - 只合并本次变化（partial merge），不是全量覆盖；
   * - expectedUpdatedAt 乐观锁，冲突抛 ConflictException（409）；
   * - 不做客户端读出全部画像后全量覆盖。
   */
  async patchProfile(
    userId: string,
    rawChanges: Record<string, unknown>,
    expectedUpdatedAt?: string,
  ): Promise<{ profile: unknown; updatedAt: string }> {
    // 1. 过滤白名单
    const changes = this.filterWhitelist(rawChanges);
    if (Object.keys(changes).length === 0) {
      throw new ConflictException('没有可更新的字段（白名单过滤后为空）');
    }

    // 2. 读取当前画像（必须先读后写，不是全量覆盖）
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });

    // 3. 乐观锁检查
    if (expectedUpdatedAt !== undefined) {
      if (!row) {
        throw new ConflictException({
          error: 'VERSION_CONFLICT',
          message: '画像尚未创建，无法基于 expectedUpdatedAt 更新',
        });
      }
      const currentUpdatedAt = row.updatedAt.toISOString();
      if (currentUpdatedAt !== expectedUpdatedAt) {
        throw new ConflictException({
          error: 'VERSION_CONFLICT',
          message: '画像已在其他设备更新，请基于最新信息重试',
          profile: row.profile,
          updatedAt: currentUpdatedAt,
        });
      }
    }

    // 4. 合并：读取当前画像（或空对象），合并白名单字段
    const currentProfile =
      row?.profile && typeof row.profile === 'object' && !Array.isArray(row.profile)
        ? (row.profile as Record<string, unknown>)
        : {};
    const merged = { ...currentProfile, ...changes };
    if (this.isRecord(changes.extraAnswers)) {
      merged.extraAnswers = {
        ...(this.isRecord(currentProfile.extraAnswers)
          ? currentProfile.extraAnswers
          : {}),
        ...changes.extraAnswers,
      };
    }

    // 5. 带版本时使用数据库条件更新，避免先读后写覆盖并发修改。
    let updated;
    if (expectedUpdatedAt !== undefined) {
      const result = await this.prisma.userProfile.updateMany({
        where: { userId, updatedAt: row!.updatedAt },
        data: { profile: merged as never },
      });
      if (result.count !== 1) {
        const current = await this.prisma.userProfile.findUnique({ where: { userId } });
        throw new ConflictException({
          error: 'VERSION_CONFLICT',
          message: '画像已在其他设备更新，请基于最新信息重试',
          profile: current?.profile,
          updatedAt: current?.updatedAt.toISOString(),
        });
      }
      updated = await this.prisma.userProfile.findUnique({ where: { userId } });
    } else {
      updated = await this.prisma.userProfile.upsert({
        where: { userId },
        update: { profile: merged as never },
        create: { userId, profile: merged as never },
      });
    }

    if (!updated) {
      throw new ConflictException('画像更新失败');
    }

    return {
      profile: updated.profile,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
