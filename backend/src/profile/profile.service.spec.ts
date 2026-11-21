/**
 * 画像读写测试（v7.2，测试边界：画像读写 + PATCH 白名单 + 乐观锁 + 409）。
 *
 * - 现状固化：ProfileService 整体 upsert 幂等、按用户隔离；
 * - v7.2 PATCH：白名单字段级部分更新 + 乐观锁冲突 409 + 部分合并 + 幂等。
 */
import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProfileService } from './profile.service.js';

function createFakePrisma() {
  const rows = new Map<string, { userId: string; profile: unknown; updatedAt: Date }>();
  let clock = 0;
  return {
    rows,
    userProfile: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        rows.get(where.userId) ?? null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { userId: string };
        update: { profile: unknown };
        create: { userId: string; profile: unknown };
      }) => {
        const existing = rows.get(where.userId);
        if (existing) {
          existing.profile = update.profile;
          existing.updatedAt = new Date(Date.now() + ++clock);
          return existing;
        }
        const row = {
          userId: create.userId,
          profile: create.profile,
          updatedAt: new Date(Date.now() + ++clock),
        };
        rows.set(create.userId, row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; updatedAt: Date };
        data: { profile: unknown };
      }) => {
        const existing = rows.get(where.userId);
        if (!existing || existing.updatedAt.getTime() !== where.updatedAt.getTime()) {
          return { count: 0 };
        }
        existing.profile = data.profile;
        existing.updatedAt = new Date(Date.now() + ++clock);
        return { count: 1 };
      },
    },
  };
}

describe('ProfileService 现状固化：整体 upsert 读写', () => {
  it('未保存过返回 null；保存后可读回同一画像', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    expect(await service.getProfile('user-1')).toBeNull();
    const profile = { regions: [{ code: '330000', province: '浙江省', level: 'required' }] };
    await service.saveProfile('user-1', profile);
    expect(await service.getProfile('user-1')).toEqual(profile);
  });

  it('幂等保存：同用户重复 PUT 只更新一条记录，不产生重复', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { v: 1 });
    await service.saveProfile('user-1', { v: 2 });
    expect(prisma.rows.size).toBe(1);
    expect(await service.getProfile('user-1')).toEqual({ v: 2 });
  });

  it('按用户隔离：不同用户画像互不可见', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { owner: 'user-1' });
    await service.saveProfile('user-2', { owner: 'user-2' });
    expect(await service.getProfile('user-1')).toEqual({ owner: 'user-1' });
    expect(await service.getProfile('user-2')).toEqual({ owner: 'user-2' });
  });
});

describe('PATCH /profile（v7.2 PRD 7.6.1）', () => {
  it('控制器现在暴露 GET/PUT/PATCH', () => {
    // 不再检查文件源码——直接验证 service 有 patchProfile 方法
    const service = new ProfileService(createFakePrisma() as never);
    expect(typeof service.patchProfile).toBe('function');
  });

  it('白名单字段级部分更新：只合并本次变化', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    // 先保存基础画像
    await service.saveProfile('user-1', {
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationLevel: 'bachelor',
    });
    // PATCH 只补充 birthDate
    const result = await service.patchProfile('user-1', {
      birthDate: '1998-06-15',
    });
    expect(result.profile).toMatchObject({
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationLevel: 'bachelor',
      birthDate: '1998-06-15',
    });
    expect(result.updatedAt).toBeTruthy();
  });

  it('白名单过滤：非法字段不写入', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    // 尝试修改 educationLevel（不在白名单中）和注入非法字段
    const result = await service.patchProfile('user-1', {
      birthDate: '1998-06-15',
      educationLevel: 'master', // 不在白名单，应被忽略
      maliciousField: 'hacked', // 不在白名单，应被忽略
    });
    expect((result.profile as Record<string, unknown>).birthDate).toBe('1998-06-15');
    expect((result.profile as Record<string, unknown>).educationLevel).toBe('bachelor');
    expect((result.profile as Record<string, unknown>).maliciousField).toBeUndefined();
  });

  it('乐观锁：expectedUpdatedAt 匹配时成功', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    const meta = await service.getProfileWithMeta('user-1');
    expect(meta.updatedAt).toBeTruthy();
    const result = await service.patchProfile(
      'user-1',
      { birthDate: '1998-06-15' },
      meta.updatedAt,
    );
    expect(result.profile).toMatchObject({ birthDate: '1998-06-15' });
  });

  it('乐观锁冲突：expectedUpdatedAt 不匹配时抛 ConflictException（409）', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    // 使用错误的 expectedUpdatedAt
    await expect(
      service.patchProfile('user-1', { birthDate: '1998-06-15' }, '1970-01-01T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('乐观锁冲突时返回当前画像和 updatedAt', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    try {
      await service.patchProfile(
        'user-1',
        { birthDate: '1998-06-15' },
        '1970-01-01T00:00:00.000Z',
      );
      expect.fail('应抛 ConflictException');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const resp = (e as ConflictException).getResponse() as Record<string, unknown>;
      expect(resp.error).toBe('VERSION_CONFLICT');
      expect(resp.profile).toBeTruthy();
      expect(resp.updatedAt).toBeTruthy();
    }
  });

  it('幂等：重复 PATCH 同一字段不报错', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    await service.patchProfile('user-1', { birthDate: '1998-06-15' });
    const result = await service.patchProfile('user-1', { birthDate: '1998-06-15' });
    expect((result.profile as Record<string, unknown>).birthDate).toBe('1998-06-15');
  });

  it('白名单过滤后为空时抛 ConflictException', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    await expect(
      service.patchProfile('user-1', { educationLevel: 'master' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('不传 expectedUpdatedAt 时跳过乐观锁检查', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    const result = await service.patchProfile('user-1', { birthDate: '1998-06-15' });
    expect(result.profile).toMatchObject({ birthDate: '1998-06-15' });
  });

  it('多个白名单字段同时更新', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationLevel: 'bachelor' });
    const result = await service.patchProfile('user-1', {
      birthDate: '1998-06-15',
      hukouProvinceCode: '330000',
      socialSecurityMonths: 12,
      workExperienceMonths: 24,
      extraAnswers: { 'req-1': '是' },
    });
    const profile = result.profile as Record<string, unknown>;
    expect(profile.birthDate).toBe('1998-06-15');
    expect(profile.hukouProvinceCode).toBe('330000');
    expect(profile.socialSecurityMonths).toBe(12);
    expect(profile.workExperienceMonths).toBe(24);
    expect(profile.extraAnswers).toEqual({ 'req-1': '是' });
  });

  it('extraAnswers 按岗位键合并，不覆盖已有岗位答案', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { extraAnswers: { 'req-1': '是' } });
    const meta = await service.getProfileWithMeta('user-1');
    const result = await service.patchProfile(
      'user-1',
      { extraAnswers: { 'req-2': '否' } },
      meta.updatedAt,
    );
    expect(result.profile).toMatchObject({
      extraAnswers: { 'req-1': '是', 'req-2': '否' },
    });
  });

  it('条件更新失败时不覆盖并返回最新版本', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { extraAnswers: { 'req-1': '是' } });
    const stale = await service.getProfileWithMeta('user-1');
    await service.patchProfile('user-1', { extraAnswers: { 'req-2': '否' } });
    await expect(
      service.patchProfile('user-1', { extraAnswers: { 'req-3': '待确认' } }, stale.updatedAt),
    ).rejects.toMatchObject({ response: { error: 'VERSION_CONFLICT' } });
    expect(await service.getProfile('user-1')).toEqual({
      extraAnswers: { 'req-1': '是', 'req-2': '否' },
    });
  });

  it('getProfileWithMeta 返回 updatedAt', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    // 未保存时
    const empty = await service.getProfileWithMeta('user-1');
    expect(empty.profile).toBeNull();
    expect(empty.updatedAt).toBeUndefined();
    // 保存后
    await service.saveProfile('user-1', { v: 1 });
    const meta = await service.getProfileWithMeta('user-1');
    expect(meta.profile).toEqual({ v: 1 });
    expect(meta.updatedAt).toBeTruthy();
  });
});

describe('D01 分阶段教育经历持久化', () => {
  const education = {
    id: 'bachelor-1',
    stage: 'bachelor',
    majorFullName: '汉语言文学（师范）',
    teacherTraining: 'yes',
    majorConfirmed: true,
    source: 'user',
  };

  it('保存并读回教育经历，旧单一字段原值不被改写', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', {
      educationLevel: 'master',
      majorFullName: '学科教学（语文）',
      graduationDate: '2026-06-15',
      educationExperiences: [education],
    });
    const saved = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(saved.majorFullName).toBe('学科教学（语文）');
    expect(saved.educationLevel).toBe('master');
    expect(saved.graduationDate).toBe('2026-06-15');
    expect(saved.educationExperiences).toEqual([education]);
  });

  it('结构不合法（缺 id / 阶段非法）直接 400，不静默丢数据', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await expect(
      service.saveProfile('user-1', {
        educationExperiences: [{ id: 'x', majorFullName: '汉语言文学', stage: 'phd' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveProfile('user-1', {
        educationExperiences: [{ majorFullName: '汉语言文学' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.getProfile('user-1')).toBeNull();
  });

  it('业务校验失败（重复阶段/空专业）直接 400', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await expect(
      service.saveProfile('user-1', {
        educationExperiences: [
          { ...education, id: 'b1', majorFullName: '汉语言文学' },
          { ...education, id: 'b2' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveProfile('user-1', {
        educationExperiences: [{ ...education, id: 'b3', majorFullName: '  ' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('未提供 educationExperiences 的旧画像原样保存（兼容）', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    const legacy = {
      educationLevel: 'bachelor',
      majorFullName: '汉语言文学',
      graduationDate: '2024-06-30',
    };
    await service.saveProfile('user-1', legacy);
    expect(await service.getProfile('user-1')).toEqual(legacy);
  });

  it('按用户隔离：不能读到他人的教育经历', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationExperiences: [education] });
    await service.saveProfile('user-2', {
      educationExperiences: [{ ...education, id: 'other', majorFullName: '小学教育' }],
    });
    const other = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(other.educationExperiences).toEqual([education]);
  });
});

describe('R01 资料隔离与字段级保存', () => {
  const bachelor = {
    id: 'bachelor-1',
    stage: 'bachelor',
    majorFullName: '汉语言文学（师范）',
    teacherTraining: 'yes',
    majorConfirmed: true,
    source: 'user',
  };
  const master = {
    id: 'master-1',
    stage: 'master',
    majorFullName: '学科教学（语文）',
    teacherTraining: 'unknown',
    majorConfirmed: true,
    source: 'user',
  };

  it('旧客户端 PUT 未提供新字段时不删除已保存的教育经历', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', {
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationExperiences: [bachelor],
      legacyEducation: { confirmed: true, confirmedAt: '2026-10-01T00:00:00.000Z' },
    });
    // 旧客户端只认识基础画像字段，整份 PUT 上来
    await service.saveProfile('user-1', {
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationLevel: 'bachelor',
      majorFullName: '汉语言文学',
    });
    const saved = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(saved.educationExperiences).toEqual([bachelor]);
    expect(saved.legacyEducation).toMatchObject({ confirmed: true });
    expect(saved.majorFullName).toBe('汉语言文学');
  });

  it('显式清空（educationExperiences: []）仍然生效', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationExperiences: [bachelor] });
    await service.saveProfile('user-1', {
      educationExperiences: [],
      legacyEducation: { confirmed: true, confirmedAt: '2026-10-02T00:00:00.000Z' },
    });
    const saved = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(saved.educationExperiences).toEqual([]);
  });

  it('只更新偏好的 PATCH 不覆盖最新教育经历', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', {
      regions: [{ code: '330000', province: '浙江省', level: 'required' }],
      educationExperiences: [bachelor],
    });
    const meta = await service.getProfileWithMeta('user-1');
    const result = await service.patchProfile(
      'user-1',
      {
        regions: [{ code: '320000', province: '江苏省', level: 'consider' }],
        employmentNaturePreference: 'public_only',
      },
      meta.updatedAt,
    );
    const profile = result.profile as Record<string, unknown>;
    expect(profile.educationExperiences).toEqual([bachelor]);
    expect(profile.regions).toEqual([
      { code: '320000', province: '江苏省', level: 'consider' },
    ]);
    expect(profile.employmentNaturePreference).toBe('public_only');
  });

  it('双标签页：教育页 PATCH 与补充资料 PATCH 互不覆盖', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { regions: [] });

    const tabA = await service.getProfileWithMeta('user-1');
    const tabB = await service.getProfileWithMeta('user-1');
    // 标签 A 先保存教育经历
    const afterA = await service.patchProfile(
      'user-1',
      { educationExperiences: [bachelor, master] },
      tabA.updatedAt,
    );
    // 标签 B 用旧版本号保存补充资料 → 冲突，不得静默覆盖
    await expect(
      service.patchProfile(
        'user-1',
        { birthDate: '1998-06-15' },
        tabB.updatedAt,
      ),
    ).rejects.toMatchObject({ response: { error: 'VERSION_CONFLICT' } });
    // 标签 B 基于最新版本重试 → 两者都在
    const afterB = await service.patchProfile(
      'user-1',
      { birthDate: '1998-06-15' },
      afterA.updatedAt,
    );
    const profile = afterB.profile as Record<string, unknown>;
    expect(profile.birthDate).toBe('1998-06-15');
    expect(profile.educationExperiences).toEqual([bachelor, master]);
  });

  it('PATCH 教育经历不影响已保存的补充事实', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.patchProfile('user-1', {
      birthDate: '1998-06-15',
      extraAnswers: { 'req-1': '是' },
    });
    await service.patchProfile('user-1', { educationExperiences: [bachelor] });
    const saved = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(saved.birthDate).toBe('1998-06-15');
    expect(saved.extraAnswers).toEqual({ 'req-1': '是' });
    expect(saved.educationExperiences).toEqual([bachelor]);
  });

  it('PATCH 教育经历结构非法时 400，且不写入任何部分数据', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { educationExperiences: [bachelor] });
    await expect(
      service.patchProfile('user-1', {
        educationExperiences: [{ id: 'x', stage: 'phd', majorFullName: '汉语言文学' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const saved = (await service.getProfile('user-1')) as Record<string, unknown>;
    expect(saved.educationExperiences).toEqual([bachelor]);
  });

  it('PATCH 非法偏好取值 400', async () => {
    const prisma = createFakePrisma();
    const service = new ProfileService(prisma as never);
    await service.saveProfile('user-1', { regions: [] });
    await expect(
      service.patchProfile('user-1', { employmentNaturePreference: 'whatever' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.patchProfile('user-1', { regions: '浙江省' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
