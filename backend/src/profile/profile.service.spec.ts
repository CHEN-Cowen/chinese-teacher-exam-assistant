/**
 * 画像读写测试（v7.2 工作包 0，测试边界：画像读写 + R-WP2-01/02）。
 *
 * - 现状固化：ProfileService 整体 upsert 幂等、按用户隔离；
 * - it.fails：PATCH /profile（白名单字段级更新 + 乐观锁，PRD 7.8/7.9），
 *   WP2 完成后转绿，不允许删除或放宽。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ProfileService } from './profile.service.js';

function createFakePrisma() {
  const rows = new Map<string, { userId: string; profile: unknown }>();
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
          return existing;
        }
        const row = { userId: create.userId, profile: create.profile };
        rows.set(create.userId, row);
        return row;
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

describe('PATCH /profile（R-WP2-02，PRD 7.8/7.9）', () => {
  it('现状固化：控制器仅暴露 GET/PUT（WP2 落地时必须更新本测试）', () => {
    const source = readFileSync(
      path.resolve(__dirname, 'profile.controller.ts'),
      'utf8',
    );
    expect(source).toContain('@Get(');
    expect(source).toContain('@Put(');
    expect(source).not.toContain('@Patch(');
  });

  // WP2 目标行为：白名单字段级部分更新 + updatedAt 乐观锁（409 冲突）。
  it.fails('目标行为（WP2）：控制器提供 PATCH 端点做字段级部分更新', () => {
    const source = readFileSync(
      path.resolve(__dirname, 'profile.controller.ts'),
      'utf8',
    );
    expect(source).toContain('@Patch(');
  });
});
