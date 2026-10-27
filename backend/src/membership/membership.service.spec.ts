/**
 * 会员权益测试（M11 / 整体方案 11.2、11.5）。
 *
 * - 会员状态三态 free/active/expired 只由授予记录与时间决定，
 *   与 User.role 无关（service 不读 users 表）；
 * - orderId 幂等：同一订单重复通知返回既有授予，不重复计时；
 * - 续购顺延：从 max(now, 现有最晚 endsAt) 起算，未到期不吃亏、到期不送空窗；
 * - 付费透明口径：折合每 30 天只是参考值，不是当次扣款额；
 *   年卡未经商业确认（annualSalesOpen）时即使总开关打开也不可购；
 * - 售卖总开关默认关闭：免费层=全部已上线能力（activeEntitlements 恒为空，
 *   拟开发权益未上线前不得列为已可用）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembershipService } from './membership.service.js';
import { MEMBERSHIP_PLANS, isAnnualSalesOpen, isSalesOpen } from './plans.js';

interface GrantRow {
  id: string;
  userId: string;
  plan: string;
  source: string;
  orderId: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}

function createFakePrisma() {
  const rows: GrantRow[] = [];
  let seq = 0;
  return {
    rows,
    membershipGrant: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows
          .filter((row) => row.userId === where.userId)
          .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()),
      findUnique: async ({ where }: { where: { orderId: string } }) =>
        rows.find((row) => row.orderId === where.orderId) ?? null,
      findFirst: async ({ where }: { where: { userId: string; revokedAt?: null } }) => {
        const mine = rows
          .filter((row) => {
            if (row.userId !== where.userId) return false;
            // revokedAt: null = 只看未回收；种子行缺省视为未回收
            if (where.revokedAt === null && (row as { revokedAt?: Date | null }).revokedAt) {
              return false;
            }
            return true;
          })
          .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
        return mine[0] ? { endsAt: mine[0].endsAt } : null;
      },
      create: async ({
        data,
      }: {
        data: Omit<GrantRow, 'id' | 'createdAt'>;
      }) => {
        const row: GrantRow = {
          ...data,
          id: `grant-${++seq}`,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-27T08:00:00.000Z');

/** 直接向假库插入一条授予记录 */
function seedGrant(
  rows: GrantRow[],
  partial: Partial<Omit<GrantRow, 'id' | 'createdAt'>>,
): GrantRow {
  const row: GrantRow = {
    id: `seed-${rows.length + 1}`,
    userId: 'user-1',
    plan: '30d',
    source: 'payment',
    orderId: null,
    startsAt: NOW,
    endsAt: new Date(NOW.getTime() + 30 * DAY),
    createdAt: NOW,
    ...partial,
  };
  rows.push(row);
  return row;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getMembershipView：会员状态三态', () => {
  it('免费态：无任何授予记录 → free，plan/起止为空', async () => {
    const service = new MembershipService(createFakePrisma() as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('free');
    expect(view.membership.plan).toBeNull();
    expect(view.membership.startsAt).toBeNull();
    expect(view.membership.endsAt).toBeNull();
  });

  it('有效态：存在未到期授予 → active，起止取该授予', async () => {
    const fake = createFakePrisma();
    const endsAt = new Date('2099-01-01T00:00:00.000Z');
    seedGrant(fake.rows, { plan: '90d', endsAt });
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('active');
    expect(view.membership.plan).toBe('90d');
    expect(view.membership.endsAt).toEqual(endsAt);
  });

  it('到期态：授予全部过期 → expired，起止为空（不假装仍有效）', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, { endsAt: new Date('2020-01-01T00:00:00.000Z') });
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('expired');
    expect(view.membership.startsAt).toBeNull();
    expect(view.membership.endsAt).toBeNull();
  });

  it('混合：过期授予 + 未到期授予 → active，plan 取最晚到期那条', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, { plan: '30d', endsAt: new Date('2020-01-01T00:00:00.000Z') });
    const activeEnds = new Date('2099-06-01T00:00:00.000Z');
    seedGrant(fake.rows, { plan: '365d', endsAt: activeEnds });
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('active');
    expect(view.membership.plan).toBe('365d');
    expect(view.membership.endsAt).toEqual(activeEnds);
  });

  it('按用户隔离：只统计本人授予记录', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, { userId: 'user-2', endsAt: new Date('2099-01-01T00:00:00.000Z') });
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('free');
  });

  it('全额退款回收（M12）：授予被 revoked 后状态为 expired（曾有会员），不假装从未购买', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, {
      endsAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-10-27T09:00:00.000Z'),
    } as never);
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.membership.status).toBe('expired');
    expect(view.membership.startsAt).toBeNull();
    expect(view.membership.endsAt).toBeNull();
  });

  it('回收的授予不作为续购顺延基数：退款后重购从当前时间起算', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, {
      endsAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-10-27T09:00:00.000Z'),
    } as never);
    const service = new MembershipService(fake as never);
    const renewal = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      now: NOW,
    });
    expect(renewal.startsAt).toEqual(NOW);
  });

  it('诚实原则：activeEntitlements 恒为空——拟开发权益未上线前不列为已可用', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, { endsAt: new Date('2099-01-01T00:00:00.000Z') });
    const service = new MembershipService(fake as never);
    const view = await service.getMembershipView('user-1');
    expect(view.activeEntitlements).toEqual([]);
  });
});

describe('getMembershipView：套餐可购性与售卖开关', () => {
  it('默认（未配置 env）售卖关闭：全部套餐 purchasable=false，salesOpen=false', async () => {
    delete process.env.MEMBERSHIP_SALES_ENABLED;
    delete process.env.MEMBERSHIP_ANNUAL_SALES_ENABLED;
    const service = new MembershipService(createFakePrisma() as never);
    const view = await service.getMembershipView('user-1');
    expect(view.salesOpen).toBe(false);
    expect(view.plans.every((plan) => !plan.purchasable)).toBe(true);
  });

  it('总开关打开：30d/90d 可购；年卡未经商业确认仍不可购', async () => {
    vi.stubEnv('MEMBERSHIP_SALES_ENABLED', 'true');
    const service = new MembershipService(createFakePrisma() as never);
    const view = await service.getMembershipView('user-1');
    expect(view.salesOpen).toBe(true);
    const byKey = Object.fromEntries(view.plans.map((p) => [p.key, p.purchasable]));
    expect(byKey['30d']).toBe(true);
    expect(byKey['90d']).toBe(true);
    expect(byKey['365d']).toBe(false);
  });

  it('总开关 + 年卡开关同时打开：年卡才可购', async () => {
    vi.stubEnv('MEMBERSHIP_SALES_ENABLED', 'true');
    vi.stubEnv('MEMBERSHIP_ANNUAL_SALES_ENABLED', 'true');
    const service = new MembershipService(createFakePrisma() as never);
    const view = await service.getMembershipView('user-1');
    const annual = view.plans.find((p) => p.key === '365d');
    expect(annual?.purchasable).toBe(true);
  });

  it('年卡开关不能绕过售卖总开关', async () => {
    vi.stubEnv('MEMBERSHIP_ANNUAL_SALES_ENABLED', 'true');
    const service = new MembershipService(createFakePrisma() as never);
    const view = await service.getMembershipView('user-1');
    expect(view.plans.every((plan) => !plan.purchasable)).toBe(true);
  });
});

describe('getPlans：公开套餐展示（价格页未登录可读）', () => {
  it('与 /mine 共用同一份套餐配置，且不暴露任何用户的会员状态', async () => {
    vi.stubEnv('MEMBERSHIP_SALES_ENABLED', 'true');
    const fake = createFakePrisma();
    seedGrant(fake.rows, { endsAt: new Date('2099-01-01T00:00:00.000Z') });
    const service = new MembershipService(fake as never);
    const plans = service.getPlans();
    const mine = await service.getMembershipView('user-1');
    expect(plans.plans).toEqual(mine.plans);
    expect(plans.salesOpen).toBe(true);
    expect(plans).not.toHaveProperty('membership');
  });
});

describe('issueGrant：发放、幂等与续购顺延', () => {
  it('无 orderId 直接创建：从 now 起算 30 天', async () => {
    const fake = createFakePrisma();
    const service = new MembershipService(fake as never);
    const result = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'manual',
      now: NOW,
    });
    expect(result.alreadyIssued).toBe(false);
    expect(result.startsAt).toEqual(NOW);
    expect(result.endsAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ userId: 'user-1', plan: '30d', source: 'manual' });
  });

  it('orderId 幂等：同一订单重复通知返回既有授予，不新增行、不重复计时', async () => {
    const fake = createFakePrisma();
    const service = new MembershipService(fake as never);
    const first = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      orderId: 'wx-order-1',
      now: NOW,
    });
    const second = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      orderId: 'wx-order-1',
      now: new Date(NOW.getTime() + 5 * DAY),
    });
    expect(second.alreadyIssued).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.startsAt).toEqual(first.startsAt);
    expect(second.endsAt).toEqual(first.endsAt);
    expect(fake.rows).toHaveLength(1);
  });

  it('不同 orderId 是不同订单：各自发放并顺延', async () => {
    const fake = createFakePrisma();
    const service = new MembershipService(fake as never);
    await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      orderId: 'wx-order-1',
      now: NOW,
    });
    const second = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      orderId: 'wx-order-2',
      now: new Date(NOW.getTime() + 10 * DAY),
    });
    expect(second.alreadyIssued).toBe(false);
    // 顺延：从第一份的 endsAt（now+30d）起算
    expect(second.startsAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(second.endsAt).toEqual(new Date(NOW.getTime() + 60 * DAY));
    expect(fake.rows).toHaveLength(2);
  });

  it('未到期续购 90 天：从现有最晚到期时间起算，不吃亏', async () => {
    const fake = createFakePrisma();
    const service = new MembershipService(fake as never);
    await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      now: NOW,
    });
    const renewal = await service.issueGrant({
      userId: 'user-1',
      plan: '90d',
      source: 'payment',
      now: new Date(NOW.getTime() + 10 * DAY),
    });
    expect(renewal.startsAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(renewal.endsAt).toEqual(new Date(NOW.getTime() + 120 * DAY));
  });

  it('到期后续购：从当前时间起算，不送空窗天数', async () => {
    const fake = createFakePrisma();
    seedGrant(fake.rows, { endsAt: new Date(NOW.getTime() - 5 * DAY) });
    const service = new MembershipService(fake as never);
    const renewal = await service.issueGrant({
      userId: 'user-1',
      plan: '30d',
      source: 'payment',
      now: NOW,
    });
    expect(renewal.startsAt).toEqual(NOW);
    expect(renewal.endsAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });

  it('未知套餐抛错：不产生任何授予记录', async () => {
    const fake = createFakePrisma();
    const service = new MembershipService(fake as never);
    await expect(
      service.issueGrant({
        userId: 'user-1',
        plan: '7d' as never,
        source: 'manual',
        now: NOW,
      }),
    ).rejects.toThrow('未知会员套餐');
    expect(fake.rows).toHaveLength(0);
  });
});

describe('套餐配置与透明口径（整体方案 11.5、11.6）', () => {
  it('三档套餐：当次实付与天数是权威数字，主推 90 天', () => {
    expect(MEMBERSHIP_PLANS.map((p) => [p.key, p.days, p.priceCents])).toEqual([
      ['30d', 30, 2900],
      ['90d', 90, 5900],
      ['365d', 365, 16900],
    ]);
    const featured = MEMBERSHIP_PLANS.filter((p) => p.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0].key).toBe('90d');
  });

  it('折合每 30 天只是参考值：必须小于当次实付（长期限才划算），不是扣款额', () => {
    for (const plan of MEMBERSHIP_PLANS) {
      // 30 天卡的折合参考等于实付；更长期限的折合必须更划算
      expect(plan.per30dReferenceCents).toBeLessThanOrEqual(plan.priceCents);
    }
    // 90 天卡对比口径：连续三次 30 天（¥87）比 90 天卡（¥59）贵 ¥28
    const d30 = MEMBERSHIP_PLANS.find((p) => p.key === '30d')!;
    const d90 = MEMBERSHIP_PLANS.find((p) => p.key === '90d')!;
    expect(d30.priceCents * 3 - d90.priceCents).toBe(2800);
  });

  it('年卡默认不可售；isSalesOpen 默认关闭', () => {
    delete process.env.MEMBERSHIP_SALES_ENABLED;
    delete process.env.MEMBERSHIP_ANNUAL_SALES_ENABLED;
    expect(isSalesOpen()).toBe(false);
    expect(isAnnualSalesOpen()).toBe(false);
    const annual = MEMBERSHIP_PLANS.find((p) => p.key === '365d')!;
    expect(annual.annualSalesOpen).toBe(false);
  });
});
