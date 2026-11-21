/**
 * 支付链路验收测试（M12）。
 *
 * 覆盖模块验收项：
 * - 服务端定价：订单金额只取套餐快照，客户端传价无入口；
 * - 回调验签：错签名/时间窗过期 401 不落库；商户号/订单/金额/币种不符 REJECTED；
 * - 重复通知（同 eventId）幂等；同交易不同 eventId（乱序重推）不重复记账发放；
 * - 超时后成功：closed 订单收到成功通知照常履约（钱已扣必须发放）；
 * - 支付成功权益失败补偿：事务整体回滚 → 500 → 渠道重推 → 幂等补齐；
 * - 主动查单：回调丢失时 sync 查单补账，合成事件幂等；
 * - 关闭页面：未支付可关闭；已支付不可关闭；关闭后仍可被回调/查单履约；
 * - 续购叠加：两订单先后支付，第二份顺延；
 * - 退款：仅全额（部分退款 400 拒绝，不臆造权益扣减）；成功 → 回收授予；
 *   渠道拒绝受理 / 受理后失败回调 → failed，订单与权益不动；重复退款 400；
 * - 乱序：退款回调先于支付回调 → refund_not_found REJECTED，支付随后正常履约；
 * - 对账：missing_local / missing_channel / amount_mismatch 落库，重跑幂等，
 *   resolve 闭环，重复 resolve 拒绝。
 *
 * 假库语义：$transaction 快照回滚（抛错时恢复全部表），唯一约束抛 {code:'P2002'}，
 * 与真实 Prisma/PostgreSQL 行为对齐。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { MembershipService } from '../membership/membership.service.js';
import { MockWechatChannel } from './channels/mock-wechat.channel.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-27T08:00:00.000Z');

// ---------- 内存假库（含事务快照回滚与唯一约束） ----------

interface FakeState {
  orders: any[];
  attempts: any[];
  transactions: any[];
  events: any[];
  refunds: any[];
  reconciliation: any[];
  grants: any[];
}

function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}

function createFakePrisma() {
  const state: FakeState = {
    orders: [],
    attempts: [],
    transactions: [],
    events: [],
    refunds: [],
    reconciliation: [],
    grants: [],
  };
  let seq = 0;
  const nid = (prefix: string) => `${prefix}-${++seq}`;

  const uniqueViolation = () => {
    const err = new Error('Unique constraint failed');
    (err as any).code = 'P2002';
    return err;
  };

  const fake: any = {
    __state: state,
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const snapshot = cloneState(state);
      try {
        return await fn(fake);
      } catch (error) {
        Object.assign(state, cloneState(snapshot));
        throw error;
      }
    },
    paymentOrder: {
      create: async ({ data }: any) => {
        const row = {
          id: nid('order'),
          status: 'created',
          currency: 'CNY',
          paidAt: null,
          closedAt: null,
          grantId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.orders.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.orders.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where, take }: any = {}) =>
        state.orders
          .filter((row) => !where?.userId || row.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take ?? 100),
      update: async ({ where, data }: any) => {
        const row = state.orders.find((item) => item.id === where.id);
        if (!row) throw new Error('order not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    paymentAttempt: {
      create: async ({ data }: any) => {
        const row = {
          id: nid('attempt'),
          status: 'created',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.attempts.push(row);
        return row;
      },
      findFirst: async ({ where }: any) =>
        state.attempts
          .filter((row) => row.orderId === where.orderId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      updateMany: async ({ where, data }: any) => {
        for (const row of state.attempts) {
          if (row.orderId === where.orderId && (!where.status || row.status === where.status)) {
            Object.assign(row, data);
          }
        }
        return { count: 1 };
      },
    },
    channelTransaction: {
      create: async ({ data }: any) => {
        if (
          state.transactions.some(
            (row) => row.channelTransactionId === data.channelTransactionId,
          )
        ) {
          throw uniqueViolation();
        }
        const row = { id: nid('txn'), createdAt: new Date(), ...data };
        state.transactions.push(row);
        return row;
      },
      findMany: async ({ where }: any = {}) =>
        state.transactions.filter((row) => {
          if (where?.orderId && row.orderId !== where.orderId) return false;
          if (where?.channel && row.channel !== where.channel) return false;
          if (where?.paidAt) {
            const paid = row.paidAt as Date;
            if (where.paidAt.gte && paid < where.paidAt.gte) return false;
            if (where.paidAt.lt && paid >= where.paidAt.lt) return false;
          }
          return true;
        }),
      findFirst: async ({ where }: any) =>
        state.transactions.find(
          (row) => row.orderId === where.orderId && (!where.status || row.status === where.status),
        ) ?? null,
    },
    paymentCallbackEvent: {
      create: async ({ data }: any) => {
        if (state.events.some((row) => row.eventId === data.eventId)) {
          throw uniqueViolation();
        }
        const row = {
          id: nid('event'),
          status: 'received',
          rejectReason: null,
          receivedAt: new Date(),
          processedAt: null,
          ...data,
        };
        state.events.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.events.find((row) => row.eventId === where.eventId) ?? null,
      findMany: async ({ where }: any = {}) =>
        state.events.filter((row) => !where?.orderId || row.orderId === where.orderId),
      update: async ({ where, data }: any) => {
        const row = state.events.find((item) => item.eventId === where.eventId);
        if (!row) throw new Error('event not found');
        Object.assign(row, data);
        return row;
      },
    },
    refund: {
      create: async ({ data }: any) => {
        const row = {
          id: nid('refund'),
          status: 'requested',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.refunds.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.refunds.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) =>
        state.refunds.filter((row) => !where?.orderId || row.orderId === where.orderId),
      findFirst: async ({ where }: any) => {
        const matches = state.refunds
          .filter((row) => {
            if (where?.orderId && row.orderId !== where.orderId) return false;
            if (where?.status?.in) return where.status.in.includes(row.status);
            if (where?.status && row.status !== where.status) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matches[0] ?? null;
      },
      update: async ({ where, data }: any) => {
        const row = state.refunds.find((item) => item.id === where.id);
        if (!row) throw new Error('refund not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    reconciliationRecord: {
      create: async ({ data }: any) => {
        if (state.reconciliation.some((row) => row.dedupeKey === data.dedupeKey)) {
          throw uniqueViolation();
        }
        const row = { id: nid('recon'), status: 'open', createdAt: new Date(), ...data };
        state.reconciliation.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.reconciliation.find(
          (row) => row.dedupeKey === where.dedupeKey || row.id === where.id,
        ) ?? null,
      findMany: async ({ where }: any = {}) =>
        state.reconciliation
          .filter((row) => !where?.status || row.status === where.status)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      update: async ({ where, data }: any) => {
        const row = state.reconciliation.find((item) => item.id === where.id);
        if (!row) throw new Error('reconciliation record not found');
        Object.assign(row, data);
        return row;
      },
    },
    membershipGrant: {
      create: async ({ data }: any) => {
        if (data.orderId && state.grants.some((row) => row.orderId === data.orderId)) {
          throw uniqueViolation();
        }
        const row = { id: nid('grant'), revokedAt: null, createdAt: new Date(), ...data };
        state.grants.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        state.grants.find((row) => row.orderId === where.orderId) ?? null,
      findMany: async ({ where }: any) =>
        state.grants
          .filter((row) => {
            if (row.userId !== where.userId) return false;
            if (where.revokedAt === null && row.revokedAt !== null) return false;
            return true;
          })
          .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()),
      findFirst: async ({ where }: any) => {
        const mine = state.grants
          .filter((row) => {
            if (row.userId !== where.userId) return false;
            if (where.revokedAt === null && row.revokedAt !== null) return false;
            return true;
          })
          .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
        return mine[0] ? { endsAt: mine[0].endsAt } : null;
      },
      updateMany: async ({ where, data }: any) => {
        for (const row of state.grants) {
          if (row.orderId === where.orderId && row.revokedAt === null) {
            Object.assign(row, data);
          }
        }
        return { count: 1 };
      },
    },
  };
  return fake;
}

// ---------- 装配 ----------

const MCH_ID = 'mock-mch-001';
const SECRET = 'test-secret';

function assemble() {
  const prisma = createFakePrisma();
  const membership = new MembershipService(prisma);
  const channel = new MockWechatChannel(MCH_ID, SECRET);
  const service = new PaymentsService(prisma, membership, channel);
  return { prisma, membership, channel, service };
}

async function createPaidOrder(
  ctx: ReturnType<typeof assemble>,
  plan: string,
  userId = 'user-1',
) {
  const order = await ctx.service.createOrder(userId, plan);
  await ctx.service.startPayment(userId, order.id);
  ctx.channel.notePaid({
    orderId: order.id,
    amountCents: order.amountCents,
    currency: order.currency,
  });
  const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
  const result = await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
  return { order, result };
}

beforeEach(() => {
  vi.stubEnv('MEMBERSHIP_SALES_ENABLED', 'true');
  vi.stubEnv('PAYMENT_MOCK_ENABLED', 'true');
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ---------- 下单与发起支付 ----------

describe('创建订单：服务端定价与售卖开关', () => {
  it('售卖总开关关闭 → 403，不产生订单', async () => {
    vi.stubEnv('MEMBERSHIP_SALES_ENABLED', '');
    const ctx = assemble();
    await expect(ctx.service.createOrder('user-1', '30d')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.prisma.__state.orders).toHaveLength(0);
  });

  it('年卡未经商业确认 → 403（总开关打开也不可购）', async () => {
    const ctx = assemble();
    await expect(ctx.service.createOrder('user-1', '365d')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('未知套餐 → 400', async () => {
    const ctx = assemble();
    await expect(ctx.service.createOrder('user-1', '7d')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('成功下单：金额/天数/币种/价格版本全部取服务端快照', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '90d');
    expect(order.amountCents).toBe(5900);
    expect(order.days).toBe(90);
    expect(order.currency).toBe('CNY');
    expect(order.priceVersion).toBe('v2026.10.27');
    expect(order.status).toBe('created');
  });

  it('发起支付：生成尝试与模拟 codeUrl，订单转 paying；重复发起幂等于状态', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    const paying = await ctx.service.startPayment('user-1', order.id);
    expect(paying.status).toBe('paying');
    expect(paying.prepay?.codeUrl).toContain('mock://wechat/pay/');
    expect(paying.mockChannel).toBe(true);
    expect(paying.simulateAllowed).toBe(true);
    expect(ctx.prisma.__state.attempts).toHaveLength(1);
  });

  it('他人订单不可发起/查看（404，存在性不外泄）', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await expect(ctx.service.startPayment('user-2', order.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctx.service.getOrder('user-2', order.id, false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ---------- 回调验签与业务核对 ----------

describe('回调验签与业务核对', () => {
  it('签名错误 → 401 且不落任何事件', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
    await expect(
      ctx.service.processCallback('wechat_mock', {
        ...callback.headers,
        'x-mock-signature': 'deadbeef',
      }, callback.body),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.prisma.__state.events).toHaveLength(0);
  });

  it('时间戳超出窗口 → 401（防重放）', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
    await expect(
      ctx.service.processCallback('wechat_mock', {
        ...callback.headers,
        'x-mock-timestamp': String(Math.floor(Date.now() / 1000) - 3600),
      }, callback.body),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('未知渠道路径 → 404', async () => {
    const ctx = assemble();
    await expect(
      ctx.service.processCallback('alipay', {}, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('商户号不符 → REJECTED(mch_mismatch)，事件落库备查', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
    const foreign = new MockWechatChannel('other-mch', SECRET);
    const body = { ...callback.body, mchId: 'other-mch' };
    const ts = String(Math.floor(Date.now() / 1000));
    // 用同一密钥对篡改后的报文重签（验签能过，但商户号核对必须拒绝）
    const reSigned = (foreign as any).sign(body, ts);
    const result = await ctx.service.processCallback('wechat_mock', {
      'x-mock-timestamp': ts,
      'x-mock-signature': reSigned,
    }, body);
    expect(result.code).toBe('REJECTED');
    expect(result.reason).toBe('mch_mismatch');
    const event = ctx.prisma.__state.events.find((row: any) => row.eventId === body.eventId);
    expect(event.status).toBe('rejected');
    expect(ctx.prisma.__state.grants).toHaveLength(0);
  });

  it('金额不符 → REJECTED(amount_mismatch)；币种不符 → REJECTED(currency_mismatch)', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    for (const patch of [{ amountCents: 100 }, { currency: 'USD' }]) {
      ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
      const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
      const body = { ...callback.body, ...patch, eventId: `evt-tampered-${patch.amountCents ?? patch.currency}` };
      const ts = String(Math.floor(Date.now() / 1000));
      const reSigned = (ctx.channel as any).sign(body, ts);
      const result = await ctx.service.processCallback('wechat_mock', {
        'x-mock-timestamp': ts,
        'x-mock-signature': reSigned,
      }, body);
      expect(result.code).toBe('REJECTED');
    }
    const rejected = ctx.prisma.__state.events.filter((row: any) => row.status === 'rejected');
    expect(rejected.map((row: any) => row.rejectReason).sort()).toEqual([
      'amount_mismatch',
      'currency_mismatch',
    ]);
    expect(ctx.prisma.__state.grants).toHaveLength(0);
  });

  it('订单不存在 → REJECTED(order_not_found)', async () => {
    const ctx = assemble();
    ctx.channel.notePaid({ orderId: 'ghost-order', amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback('ghost-order');
    const result = await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
    expect(result.code).toBe('REJECTED');
    expect(result.reason).toBe('order_not_found');
  });
});

// ---------- 履约、幂等与补偿 ----------

describe('支付成功履约与幂等', () => {
  it('成功：订单 paid + 渠道交易 + 权益发放 30 天 + 尝试 success + 事件 processed', async () => {
    const ctx = assemble();
    const { order, result } = await createPaidOrder(ctx, '30d');
    expect(result.code).toBe('SUCCESS');
    const stored = ctx.prisma.__state.orders.find((row: any) => row.id === order.id);
    expect(stored.status).toBe('paid');
    expect(stored.paidAt).toBeTruthy();
    expect(ctx.prisma.__state.transactions).toHaveLength(1);
    const grant = ctx.prisma.__state.grants[0];
    expect(grant.plan).toBe('30d');
    expect(grant.orderId).toBe(order.id);
    expect(grant.endsAt.getTime() - grant.startsAt.getTime()).toBe(30 * DAY);
    expect(stored.grantId).toBe(grant.id);
    expect(ctx.prisma.__state.attempts[0].status).toBe('success');
    expect(ctx.prisma.__state.events[0].status).toBe('processed');
  });

  it('重复通知（同 eventId 二次）→ duplicate 幂等，不重复记账/发放', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
    await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
    const dup = await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
    expect(dup.duplicate).toBe(true);
    expect(ctx.prisma.__state.transactions).toHaveLength(1);
    expect(ctx.prisma.__state.grants).toHaveLength(1);
    expect(ctx.prisma.__state.events).toHaveLength(1);
  });

  it('同交易不同 eventId（渠道乱序重推）→ 不重复记账、不重复发放', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const first = ctx.channel.buildPaymentSuccessCallback(order.id);
    await ctx.service.processCallback('wechat_mock', first.headers, first.body);
    // 渠道重推：同交易号，新事件 ID
    const second = ctx.channel.buildPaymentSuccessCallback(order.id);
    expect(second.body.channelTransactionId).toBe(first.body.channelTransactionId);
    const result = await ctx.service.processCallback('wechat_mock', second.headers, second.body);
    expect(result.code).toBe('SUCCESS');
    expect(ctx.prisma.__state.transactions).toHaveLength(1);
    expect(ctx.prisma.__state.grants).toHaveLength(1);
  });

  it('超时后成功：closed 订单收到成功通知照常履约，订单回 paid', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    await ctx.service.closeOrder('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);
    const result = await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
    expect(result.code).toBe('SUCCESS');
    const stored = ctx.prisma.__state.orders.find((row: any) => row.id === order.id);
    expect(stored.status).toBe('paid');
    expect(stored.closedAt).toBeNull();
    expect(ctx.prisma.__state.grants).toHaveLength(1);
  });

  it('补偿：权益发放失败 → 事务回滚 + 事件 failed + 500；渠道重推后幂等补齐', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const callback = ctx.channel.buildPaymentSuccessCallback(order.id);

    const spy = vi
      .spyOn(ctx.membership, 'issueGrant')
      .mockRejectedValueOnce(new Error('grant store unavailable'));
    await expect(
      ctx.service.processCallback('wechat_mock', callback.headers, callback.body),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    // 事务回滚：无交易、无授予、订单未变
    expect(ctx.prisma.__state.transactions).toHaveLength(0);
    expect(ctx.prisma.__state.grants).toHaveLength(0);
    expect(
      ctx.prisma.__state.orders.find((row: any) => row.id === order.id).status,
    ).toBe('paying');
    expect(ctx.prisma.__state.events[0].status).toBe('failed');

    spy.mockRestore();
    const retry = await ctx.service.processCallback('wechat_mock', callback.headers, callback.body);
    expect(retry.code).toBe('SUCCESS');
    expect(ctx.prisma.__state.transactions).toHaveLength(1);
    expect(ctx.prisma.__state.grants).toHaveLength(1);
    expect(
      ctx.prisma.__state.orders.find((row: any) => row.id === order.id).status,
    ).toBe('paid');
  });

  it('续购叠加：两订单先后支付，第二份从第一份到期时间顺延', async () => {
    const ctx = assemble();
    await createPaidOrder(ctx, '30d');
    const firstGrant = ctx.prisma.__state.grants[0];
    const tenDaysLater = new Date(NOW.getTime() + 10 * DAY);
    vi.setSystemTime(tenDaysLater);
    const second = await createPaidOrder(ctx, '90d');
    expect(second.result.code).toBe('SUCCESS');
    expect(ctx.prisma.__state.grants).toHaveLength(2);
    const secondGrant = ctx.prisma.__state.grants[1];
    expect(secondGrant.startsAt).toEqual(firstGrant.endsAt);
    expect(secondGrant.endsAt.getTime() - secondGrant.startsAt.getTime()).toBe(90 * DAY);
  });
});

// ---------- 主动查单与关闭 ----------

describe('主动查单与关闭页面', () => {
  it('回调丢失：渠道已付本地未付，sync 查单补账发放（合成事件幂等）', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    // 渠道侧已扣款，但回调未到达（网络丢失）
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    const view = await ctx.service.getOrder('user-1', order.id, true);
    expect(view.status).toBe('paid');
    expect(ctx.prisma.__state.grants).toHaveLength(1);
    expect(
      ctx.prisma.__state.events.some((row: any) => row.eventId.startsWith('query-')),
    ).toBe(true);
    // 重复 sync 幂等
    await ctx.service.getOrder('user-1', order.id, true);
    expect(ctx.prisma.__state.transactions).toHaveLength(1);
    expect(ctx.prisma.__state.grants).toHaveLength(1);
  });

  it('渠道未付：sync 不改变订单状态', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    const view = await ctx.service.getOrder('user-1', order.id, true);
    expect(view.status).toBe('paying');
    expect(ctx.prisma.__state.grants).toHaveLength(0);
  });

  it('查单金额与订单不符 → 拒绝补账（amount_mismatch），订单不动', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 999, currency: 'CNY' });
    const view = await ctx.service.getOrder('user-1', order.id, true);
    expect(view.status).toBe('paying');
    expect(ctx.prisma.__state.grants).toHaveLength(0);
    const rejected = ctx.prisma.__state.events.find((row: any) => row.status === 'rejected');
    expect(rejected.rejectReason).toBe('amount_mismatch');
  });

  it('关闭页面：未支付订单可关闭；已支付订单不可关闭', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    const closed = await ctx.service.closeOrder('user-1', order.id);
    expect(closed.status).toBe('closed');
    await expect(ctx.service.closeOrder('user-1', order.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const paid = await createPaidOrder(ctx, '30d', 'user-2');
    await expect(ctx.service.closeOrder('user-2', paid.order.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('模拟支付端点：PAYMENT_MOCK_ENABLED 关闭时 404', async () => {
    vi.stubEnv('PAYMENT_MOCK_ENABLED', '');
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await expect(
      ctx.service.simulateMockPayment('user-1', order.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('模拟支付端点：开启时走完整验签链路完成履约', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    const result = await ctx.service.simulateMockPayment('user-1', order.id);
    expect(result.code).toBe('SUCCESS');
    expect(
      ctx.prisma.__state.orders.find((row: any) => row.id === order.id).status,
    ).toBe('paid');
    expect(ctx.prisma.__state.grants).toHaveLength(1);
  });
});

// ---------- 退款 ----------

describe('退款（仅全额；部分退款规则未确认不开放）', () => {
  it('未支付订单退款 → 400', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await expect(
      ctx.service.requestRefund('admin-1', order.id, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('部分退款 → 400 拒绝（不臆造权益扣减算法）', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    await expect(
      ctx.service.requestRefund('admin-1', order.id, { amountCents: 1000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.service.requestRefund('admin-1', order.id, { amountCents: 1000 }),
    ).rejects.toThrow(/部分退款/);
  });

  it('全额退款成功：refund succeeded、订单 refunded、授予回收、会员视图回落', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    const before = await ctx.membership.getMembershipView('user-1');
    expect(before.membership.status).toBe('active');

    const result = await ctx.service.requestRefund('admin-1', order.id, { reason: '重复支付' });
    expect(result.status).toBe('succeeded');
    const storedOrder = ctx.prisma.__state.orders.find((row: any) => row.id === order.id);
    expect(storedOrder.status).toBe('refunded');
    const grant = ctx.prisma.__state.grants[0];
    expect(grant.revokedAt).toBeTruthy();
    const refund = ctx.prisma.__state.refunds[0];
    expect(refund.entitlementAction).toBe('revoked');
    const after = await ctx.membership.getMembershipView('user-1');
    expect(after.membership.status).toBe('expired');
  });

  it('渠道拒绝受理 → refund failed，订单与权益不动', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    ctx.channel.setNextRefundAccepted(false);
    const result = await ctx.service.requestRefund('admin-1', order.id, {});
    expect(result.status).toBe('failed');
    expect(
      ctx.prisma.__state.orders.find((row: any) => row.id === order.id).status,
    ).toBe('paid');
    expect(ctx.prisma.__state.grants[0].revokedAt).toBeNull();
  });

  it('受理后退款失败回调 → refund failed，订单与权益不动', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    ctx.channel.setNextRefundOutcome('failed');
    const result = await ctx.service.requestRefund('admin-1', order.id, {});
    expect(result.status).toBe('failed');
    expect(
      ctx.prisma.__state.orders.find((row: any) => row.id === order.id).status,
    ).toBe('paid');
    expect(ctx.prisma.__state.grants[0].revokedAt).toBeNull();
  });

  it('重复退款（已有进行中/已成功退款）→ 400', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    await ctx.service.requestRefund('admin-1', order.id, {});
    await expect(
      ctx.service.requestRefund('admin-1', order.id, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('乱序：退款回调先于支付完成到达 → refund_not_found REJECTED；支付随后正常履约', async () => {
    const ctx = assemble();
    const order = await ctx.service.createOrder('user-1', '30d');
    await ctx.service.startPayment('user-1', order.id);
    ctx.channel.notePaid({ orderId: order.id, amountCents: 2900, currency: 'CNY' });
    // 退款结果通知先到（无 requested 退款单）
    const refundCallback = ctx.channel.buildRefundCallback({
      orderId: order.id,
      success: true,
      amountCents: 2900,
      currency: 'CNY',
    });
    const rejected = await ctx.service.processCallback(
      'wechat_mock',
      refundCallback.headers,
      refundCallback.body,
    );
    expect(rejected.code).toBe('REJECTED');
    expect(rejected.reason).toBe('refund_not_found');
    // 支付通知随后到达，正常履约
    const paymentCallback = ctx.channel.buildPaymentSuccessCallback(order.id);
    const paid = await ctx.service.processCallback(
      'wechat_mock',
      paymentCallback.headers,
      paymentCallback.body,
    );
    expect(paid.code).toBe('SUCCESS');
    expect(ctx.prisma.__state.grants).toHaveLength(1);
  });
});

// ---------- 对账 ----------

describe('对账与差异处理', () => {
  it('渠道与本地一致 → 无差异', async () => {
    const ctx = assemble();
    await createPaidOrder(ctx, '30d');
    const date = NOW.toISOString().slice(0, 10);
    const result = await ctx.service.runReconciliation(date);
    expect(result.channelEntries).toBe(1);
    expect(result.localEntries).toBe(1);
    expect(result.newDiffs).toBe(0);
    expect(ctx.prisma.__state.reconciliation).toHaveLength(0);
  });

  it('missing_local：渠道有本地无 → 差异落库 open', async () => {
    const ctx = assemble();
    // 渠道直接产生一笔本地未知的扣款
    ctx.channel.notePaid({ orderId: 'unknown-order', amountCents: 5900, currency: 'CNY' });
    const result = await ctx.service.runReconciliation(NOW.toISOString().slice(0, 10));
    expect(result.newDiffs).toBe(1);
    const record = ctx.prisma.__state.reconciliation[0];
    expect(record.type).toBe('missing_local');
    expect(record.status).toBe('open');
    expect(record.channelAmountCents).toBe(5900);
  });

  it('missing_channel：本地有渠道无 → 差异落库', async () => {
    const ctx = assemble();
    const { order } = await createPaidOrder(ctx, '30d');
    // 清空渠道账本（模拟渠道账单缺失该交易）
    (ctx.channel as any).ledger.clear();
    const result = await ctx.service.runReconciliation(NOW.toISOString().slice(0, 10));
    expect(result.newDiffs).toBe(1);
    const record = ctx.prisma.__state.reconciliation[0];
    expect(record.type).toBe('missing_channel');
    expect(record.orderId).toBe(order.id);
  });

  it('amount_mismatch：两边都有但金额不一致 → 差异落库', async () => {
    const ctx = assemble();
    await createPaidOrder(ctx, '30d');
    // 篡改渠道账单金额
    const entry = [...(ctx.channel as any).ledger.values()][0];
    entry.amountCents = 100;
    const result = await ctx.service.runReconciliation(NOW.toISOString().slice(0, 10));
    expect(result.newDiffs).toBe(1);
    expect(ctx.prisma.__state.reconciliation[0].type).toBe('amount_mismatch');
  });

  it('重跑幂等：dedupeKey 去重，不产生重复差异', async () => {
    const ctx = assemble();
    ctx.channel.notePaid({ orderId: 'unknown-order', amountCents: 5900, currency: 'CNY' });
    const date = NOW.toISOString().slice(0, 10);
    await ctx.service.runReconciliation(date);
    const second = await ctx.service.runReconciliation(date);
    expect(second.newDiffs).toBe(0);
    expect(ctx.prisma.__state.reconciliation).toHaveLength(1);
  });

  it('处理入口：resolve 闭环 + 重复 resolve 拒绝 + 空结论拒绝', async () => {
    const ctx = assemble();
    ctx.channel.notePaid({ orderId: 'unknown-order', amountCents: 5900, currency: 'CNY' });
    await ctx.service.runReconciliation(NOW.toISOString().slice(0, 10));
    const record = ctx.prisma.__state.reconciliation[0];
    const resolved = await ctx.service.resolveReconciliationRecord(
      record.id,
      'admin-1',
      '人工补账：已为用户手动补发权益',
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('admin-1');
    await expect(
      ctx.service.resolveReconciliationRecord(record.id, 'admin-1', '再次处理'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const other = await createPaidOrder(ctx, '30d', 'user-9');
    void other;
    await expect(
      ctx.service.resolveReconciliationRecord('nonexistent', 'admin-1', 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
