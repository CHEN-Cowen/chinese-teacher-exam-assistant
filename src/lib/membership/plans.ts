/**
 * 会员套餐静态镜像（M11 / 整体方案 11.5、11.6）。
 *
 * 与 backend/src/membership/plans.ts 保持一致（tests/membership-parity.test.ts
 * 直接导入两端配置逐字段锁定）。价格页在无后端环境（demo / 后端不可达）时
 * 用这份镜像渲染，保证「付款前看清楚」的数字始终可见。
 *
 * 透明口径（与后端一致，测试锁定）：
 * - 当次实付与天数是唯一权威数字；
 * - 「折合每 30 天」只是比较参考，不是当次扣款额；
 * - 90 天卡对比依据是「比连续购买三次 30 天卡省 ¥28」，不标「季卡原价」；
 * - 年卡未完成商业确认前不可购；售卖总开关默认关闭。
 */

export type MembershipPlanKey = "30d" | "90d" | "365d";

export interface MembershipPlanStatic {
  key: MembershipPlanKey;
  /** 有效天数 */
  days: number;
  /** 当次实付（分） */
  priceCents: number;
  label: string;
  /** 折合每 30 天参考（分）——仅用于「折合」说明，不是扣款额 */
  per30dReferenceCents: number;
  /** 是否主推 */
  featured: boolean;
}

export const MEMBERSHIP_PLANS_STATIC: readonly MembershipPlanStatic[] = [
  {
    key: "30d",
    days: 30,
    priceCents: 2900,
    label: "30 天卡",
    per30dReferenceCents: 2900,
    featured: false,
  },
  {
    key: "90d",
    days: 90,
    priceCents: 5900,
    label: "90 天卡",
    per30dReferenceCents: 1967,
    featured: true,
  },
  {
    key: "365d",
    days: 365,
    priceCents: 16900,
    label: "365 天卡",
    per30dReferenceCents: 1389,
    featured: false,
  },
] as const;

/** 90 天卡对比依据：连续购买三次 30 天卡的总额（¥87） */
export function threeTimesMonthlyCents(): number {
  const d30 = MEMBERSHIP_PLANS_STATIC.find((p) => p.key === "30d");
  const d90 = MEMBERSHIP_PLANS_STATIC.find((p) => p.key === "90d");
  if (!d30 || !d90) return 0;
  return d30.priceCents * 3;
}

/** 分 → 元显示（¥19.67） */
export function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
