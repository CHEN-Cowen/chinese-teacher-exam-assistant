import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  MEMBERSHIP_PLANS,
  MembershipPlanKey,
  addDays,
  findPlan,
  isAnnualSalesOpen,
  isSalesOpen,
  renewalStartsAt,
} from './plans.js';

/** 用户视角的会员状态（GET /membership/mine） */
export interface MembershipView {
  /** 售卖总开关：关闭时价格页只展示不发单 */
  salesOpen: boolean;
  plans: Array<{
    key: MembershipPlanKey;
    label: string;
    days: number;
    priceCents: number;
    per30dReferenceCents: number;
    featured: boolean;
    purchasable: boolean;
  }>;
  membership: {
    /** free=从未开通；active=有效期内；expired=曾有授予但已全部到期 */
    status: 'free' | 'active' | 'expired';
    plan: MembershipPlanKey | null;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  /**
   * 已上线软件权益清单（诚实原则）：当前会员与免费层共享全部已上线能力，
   * 拟开发的高级权益（多方案/对比/批量/导出/离站通知）未上线前一律不列出，
   * 也不凭空发放。
   */
  activeEntitlements: string[];
}

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembershipView(userId: string): Promise<MembershipView> {
    const grants = await this.prisma.membershipGrant.findMany({
      where: { userId },
      orderBy: [{ endsAt: 'desc' }],
    });

    const now = new Date();
    const latest = grants[0] ?? null;
    const activeGrant =
      grants.find((grant) => grant.endsAt > now) ?? null;

    const status: MembershipView['membership']['status'] = activeGrant
      ? 'active'
      : latest
        ? 'expired'
        : 'free';

    return {
      salesOpen: isSalesOpen(),
      plans: this.plansView(),
      membership: {
        status,
        plan: (latest?.plan as MembershipPlanKey) ?? null,
        startsAt: activeGrant?.startsAt ?? null,
        endsAt: activeGrant?.endsAt ?? null,
      },
      activeEntitlements: [],
    };
  }

  /**
   * 公开套餐展示（GET /membership/plans，价格页未登录可读）。
   * 与 /mine 共用同一份配置；不暴露任何用户的会员状态。
   */
  getPlans(): {
    salesOpen: boolean;
    plans: MembershipView['plans'];
    activeEntitlements: string[];
  } {
    return {
      salesOpen: isSalesOpen(),
      plans: this.plansView(),
      activeEntitlements: [],
    };
  }

  private plansView(): MembershipView['plans'] {
    return MEMBERSHIP_PLANS.map((plan) => ({
      key: plan.key,
      label: plan.label,
      days: plan.days,
      priceCents: plan.priceCents,
      per30dReferenceCents: plan.per30dReferenceCents,
      featured: plan.featured,
      purchasable:
        isSalesOpen() &&
        (plan.key !== '365d' || isAnnualSalesOpen()),
    }));
  }

  /**
   * 发放一份限期权益（支付回调/人工补偿共用）。
   * - orderId 存在时幂等：同一订单重复通知返回既有授予，不重复计时；
   * - 顺延：与用户现有最晚到期时间衔接（未到期续购从原到期时间起算）。
   */
  async issueGrant(input: {
    userId: string;
    plan: MembershipPlanKey;
    source: 'payment' | 'manual' | 'compensation';
    orderId?: string | null;
    now?: Date;
  }): Promise<{ id: string; alreadyIssued: boolean; startsAt: Date; endsAt: Date }> {
    const plan = findPlan(input.plan);
    if (!plan) {
      throw new Error(`未知会员套餐：${input.plan}`);
    }
    const now = input.now ?? new Date();

    if (input.orderId) {
      const existing = await this.prisma.membershipGrant.findUnique({
        where: { orderId: input.orderId },
      });
      if (existing) {
        return {
          id: existing.id,
          alreadyIssued: true,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
        };
      }
    }

    const currentEndsAt = await this.prisma.membershipGrant
      .findFirst({
        where: { userId: input.userId },
        orderBy: [{ endsAt: 'desc' }],
        select: { endsAt: true },
      })
      .then((row) => row?.endsAt ?? null);

    const startsAt = renewalStartsAt(now, currentEndsAt);
    const endsAt = addDays(startsAt, plan.days);

    const created = await this.prisma.membershipGrant.create({
      data: {
        userId: input.userId,
        plan: plan.key,
        source: input.source,
        orderId: input.orderId ?? null,
        startsAt,
        endsAt,
      },
    });

    return {
      id: created.id,
      alreadyIssued: false,
      startsAt,
      endsAt,
    };
  }
}
