/**
 * PATCH /profile HTTP 集成测试（v7.2 PRD 7.6.1）。
 *
 * 覆盖 controller + service 全链路行为（401、409 响应体、白名单过滤、
 * 部分合并、乐观锁、幂等），不启动真实数据库，使用内存 fake Prisma。
 *
 * demo 模式（无环境变量 AUTH_MODE=invited）UserGuard 读 x-user-id / x-user-role 头。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ProfileController } from '../src/profile/profile.controller.js';
import { ProfileService } from '../src/profile/profile.service.js';
import { PrismaService } from '../src/prisma.service.js';

function createFakePrisma() {
  const rows = new Map<
    string,
    { userId: string; profile: unknown; updatedAt: Date }
  >();
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
      // R01 乐观锁路径：仅当 userId + updatedAt 同时匹配时才更新，返回受影响行数
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

describe('PATCH /profile (e2e)', () => {
  let app: INestApplication<App>;
  let prismaFake: ReturnType<typeof createFakePrisma>;

  beforeEach(async () => {
    prismaFake = createFakePrisma();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: prismaFake },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const authHeaders = { 'x-user-id': 'user-1', 'x-user-role': 'candidate' };

  it('无身份头 PATCH → 401', () => {
    return http()
      .patch('/profile')
      .send({ changes: { birthDate: '1995-06-15' } })
      .expect(401);
  });

  it('GET /profile 未保存 → {profile:null}，无 updatedAt', async () => {
    const res = await http().get('/profile').set(authHeaders).expect(200);
    expect(res.body.profile).toBeNull();
    expect(res.body.updatedAt).toBeUndefined();
  });

  it('PUT 保存后 GET 返回 profile + updatedAt', async () => {
    const profile = { regions: [{ code: '330000' }] };
    await http().put('/profile').set(authHeaders).send({ profile }).expect(200);

    const res = await http().get('/profile').set(authHeaders).expect(200);
    expect(res.body.profile).toEqual(profile);
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('PATCH 白名单过滤：educationLevel（非白名单）+ birthDate 仅 birthDate 入库', async () => {
    await http()
      .put('/profile')
      .set(authHeaders)
      .send({ profile: { regions: [{ code: '330000' }], educationLevel: 'bachelor' } })
      .expect(200);

    const res = await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { educationLevel: 'master', birthDate: '1995-06-15' } })
      .expect(200);

    expect(res.body.profile).toEqual({
      regions: [{ code: '330000' }],
      educationLevel: 'bachelor',
      birthDate: '1995-06-15',
    });
  });

  it('PATCH 全部为非白名单 → 409', async () => {
    await http()
      .put('/profile')
      .set(authHeaders)
      .send({ profile: { regions: [] } })
      .expect(200);

    await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { educationLevel: 'master', majorFullName: '汉语言文学' } })
      .expect(409);
  });

  it('PATCH 乐观锁：当前 updatedAt 成功；过期 updatedAt 返回 409 含 VERSION_CONFLICT + 最新 profile', async () => {
    await http()
      .put('/profile')
      .set(authHeaders)
      .send({ profile: { regions: [] } })
      .expect(200);

    const first = await http().get('/profile').set(authHeaders).expect(200);
    const updatedAt = first.body.updatedAt as string;

    // 第一次 PATCH 成功
    const ok = await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { birthDate: '1995-06-15' }, expectedUpdatedAt: updatedAt })
      .expect(200);
    expect(ok.body.profile.birthDate).toBe('1995-06-15');

    // 用旧 updatedAt 再 PATCH → 409
    const conflict = await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { birthDate: '1990-01-01' }, expectedUpdatedAt: updatedAt })
      .expect(409);
    expect(conflict.body.error).toBe('VERSION_CONFLICT');
    expect(conflict.body.updatedAt).not.toBe(updatedAt);
    expect(conflict.body.profile.birthDate).toBe('1995-06-15');
  });

  it('PATCH 部分合并：已有基础画像字段在 PATCH 后仍保留', async () => {
    await http()
      .put('/profile')
      .set(authHeaders)
      .send({ profile: { regions: [{ code: '330000' }], educationLevel: 'bachelor' } })
      .expect(200);

    const res = await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { birthDate: '1995-06-15' } })
      .expect(200);

    expect(res.body.profile).toEqual({
      regions: [{ code: '330000' }],
      educationLevel: 'bachelor',
      birthDate: '1995-06-15',
    });
  });

  it('幂等：版本已前进后重复旧 updatedAt → 409', async () => {
    await http()
      .put('/profile')
      .set(authHeaders)
      .send({ profile: { regions: [] } })
      .expect(200);

    const first = await http().get('/profile').set(authHeaders).expect(200);
    const t1 = first.body.updatedAt as string;

    await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { birthDate: '1995-06-15' }, expectedUpdatedAt: t1 })
      .expect(200);

    // 同内容、旧 updatedAt 再次 PATCH → 409（版本已前进）
    await http()
      .patch('/profile')
      .set(authHeaders)
      .send({ changes: { birthDate: '1995-06-15' }, expectedUpdatedAt: t1 })
      .expect(409);
  });
});
