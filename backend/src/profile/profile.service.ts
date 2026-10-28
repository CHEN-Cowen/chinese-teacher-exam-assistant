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

  /**
   * 幂等保存：同用户重复 PUT 只更新一条记录，不产生重复。
   *
   * R01 兼容：旧客户端不认识 educationExperiences/legacyEducation 等新字段，
   * 提交的画像不含这些键。若直接整体替换，会把服务端已保存的新字段删掉。
   * 因此 PUT 按字段合并：
   * - 请求体未出现的键保留服务端原值（未提供 ≠ 清空）；
   * - 请求体显式给出 educationExperiences: [] 视为用户显式清空，仍然覆盖。
   */
  async saveProfile(userId: string, profile: unknown): Promise<void> {
    const normalized = this.normalizeProfileEducation(profile);
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    const merged = this.mergeProfileForLegacySave(existing?.profile, normalized);
    await this.prisma.userProfile.upsert({
      where: { userId },
      update: { profile: merged as never },
      create: { userId, profile: merged as never },
    });
  }

  /**
   * PUT 合并：保留请求体未提供的新字段，避免旧客户端把服务端新数据清空。
   * 键存在即视为客户端明确给出了该值（空数组=显式清空）。
   */
  private mergeProfileForLegacySave(
    existing: unknown,
    incoming: unknown,
  ): unknown {
    if (!this.isRecord(existing) || !this.isRecord(incoming)) return incoming;
    const merged: Record<string, unknown> = { ...existing, ...incoming };
    // legacyEducation 是确认状态快照，按字段合并，避免旧客户端只带 confirmed 时丢掉 confirmedAt。
    if (this.isRecord(incoming.legacyEducation)) {
      merged.legacyEducation = {
        ...(this.isRecord(existing.legacyEducation) ? existing.legacyEducation : {}),
        ...incoming.legacyEducation,
      };
    }
    return merged;
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
   * v7.2 白名单字段（PRD 7.6.1）+ R01 扩展。
   *
   * - 条件画像字段：birthDate / 户籍 / 社保 / 工作经历 / 特有条件答案；
   * - 分阶段教育经历与旧字段确认状态（D01）：教育页保存只改这一段，
   *   不把页面加载时读到的整份旧画像 PUT 回去；
   * - 地区偏好与用工偏好（PRD 11.5）：偏好调整只改偏好字段，
   *   不覆盖最新的教育经历等其他数据。
   *
   * 仍不允许通过 PATCH 修改学历/专业等基础资格字段：
   * 基础画像修改走 onboarding。
   */
  static readonly PATCH_WHITELIST = [
    'birthDate',
    'hukouProvinceCode',
    'hukouCityCode',
    'socialSecurityMonths',
    'workExperienceMonths',
    'extraAnswers',
    'regions',
    'employmentNaturePreference',
    'educationExperiences',
    'legacyEducation',
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

  /**
   * R01：字段级更新的结构校验。
   * - regions/employmentNaturePreference 只做边界校验，不改语义；
   * - educationExperiences 复用 D01 同一套规整与业务校验（显式 [] 允许=清空）；
   * - 非法结构直接 400，不静默丢弃用户输入。
   */
  private normalizePatchChanges(
    changes: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...changes };
    if ('regions' in normalized && !Array.isArray(normalized.regions)) {
      throw new BadRequestException({
        error: 'INVALID_REGIONS',
        message: '地区偏好必须是数组',
      });
    }
    if (
      'employmentNaturePreference' in normalized &&
      normalized.employmentNaturePreference !== undefined
    ) {
      const value = normalized.employmentNaturePreference;
      if (
        value !== 'public_only' &&
        value !== 'official_open' &&
        value !== 'undecided'
      ) {
        throw new BadRequestException({
          error: 'INVALID_EMPLOYMENT_NATURE_PREFERENCE',
          message: '用工偏好取值不合法',
        });
      }
    }
    if ('legacyEducation' in normalized && normalized.legacyEducation !== undefined) {
      const value = normalized.legacyEducation;
      if (
        !this.isRecord(value) ||
        typeof value.confirmed !== 'boolean' ||
        (value.confirmedAt !== undefined &&
          typeof value.confirmedAt !== 'string')
      ) {
        throw new BadRequestException({
          error: 'INVALID_LEGACY_EDUCATION',
          message: '旧教育经历确认状态结构不合法',
        });
      }
    }
    if ('educationExperiences' in normalized) {
      if (!Array.isArray(normalized.educationExperiences)) {
        throw new BadRequestException({
          error: 'INVALID_EDUCATION_EXPERIENCES',
          message: '教育经历必须是数组',
        });
      }
      const experiences = normalizeEducationExperiences(
        normalized.educationExperiences,
      );
      if (experiences.length !== normalized.educationExperiences.length) {
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
      normalized.educationExperiences = experiences;
    }
    return normalized;
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
    // 1. 过滤白名单 + R01 结构校验
    const changes = this.normalizePatchChanges(
      this.filterWhitelist(rawChanges),
    );
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
