/**
 * 会员套餐配置（M11 / 整体方案 11.2、11.6）。
 *
 * - 三个付费期限共享同一组已上线软件权益；区别只在有效期与价格。
 * - 当次实付与天数是唯一权威数字；「折合每 30 天」只是比较参考，
 *   不得当作当次扣款额展示（前端同样受此约束，price 页有测试锁定）。
 * - 90 天卡对比口径：比连续购买三次 30 天卡省 ¥28（¥87 → ¥59），
 *   不得把 ¥87 标注为「季卡原价」。
 * - 365 天年卡建议价 ¥169：上架以持续服务与商业确认就绪为前提，
 *   未就绪时 annualSalesOpen=false，价格页如实展示「暂未上架」。
 * - 售卖总开关：MEMBERSHIP_SALES_ENABLED != 'true' 时全渠道关闭售卖
 *   （当前默认关闭：尚无已验收的可收费增值功能，免费层覆盖全部已上线能力）。
 */

export type MembershipPlanKey = '30d' | '90d' | '365d';

export interface MembershipPlanDef {
  key: MembershipPlanKey;
  /** 有效天数 */
  days: number;
  /** 当次实付（分） */
  priceCents: number;
  /** 展示名 */
  label: string;
  /** 折合每 30 天参考（分）——仅用于「折合」说明，不是扣款额 */
  per30dReferenceCents: number;
  /** 是否主推 */
  featured: boolean;
  /** 年卡等需单独商业确认的套餐是否可售 */
  annualSalesOpen?: boolean;
}

export const MEMBERSHIP_PLANS: readonly MembershipPlanDef[] = [
  {
    key: '30d',
    days: 30,
    priceCents: 2900,
    label: '30 天卡',
    per30dReferenceCents: 2900,
    featured: false,
  },
  {
    key: '90d',
    days: 90,
    priceCents: 5900,
    label: '90 天卡',
    per30dReferenceCents: 1967,
    featured: true,
  },
  {
    key: '365d',
    days: 365,
    priceCents: 16900,
    label: '365 天卡',
    per30dReferenceCents: 1389,
    featured: false,
    annualSalesOpen: false,
  },
] as const;

export function findPlan(key: string): MembershipPlanDef | undefined {
  return MEMBERSHIP_PLANS.find((plan) => plan.key === key);
}

/** 售卖总开关：默认关闭（未开放售卖时价格页只展示，不产生订单） */
export function isSalesOpen(): boolean {
  return process.env.MEMBERSHIP_SALES_ENABLED === 'true';
}

/** 年卡是否可售：总开关打开且商业确认通过（env 显式开启） */
export function isAnnualSalesOpen(): boolean {
  return isSalesOpen() && process.env.MEMBERSHIP_ANNUAL_SALES_ENABLED === 'true';
}

/**
 * 续购顺延起点（整体方案 11.2）：从 max(当前时间, 现有到期时间) 起算，
 * 未到期续购不吃亏、已到期续购不送空窗天数。
 */
export function renewalStartsAt(now: Date, currentEndsAt: Date | null): Date {
  if (!currentEndsAt || currentEndsAt <= now) return now;
  return currentEndsAt;
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
