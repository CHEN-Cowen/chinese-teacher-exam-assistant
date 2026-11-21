/**
 * 会员套餐双端一致性锁定（M11 / 整体方案 11.5、11.6）。
 *
 * 价格页在无后端环境时用前端静态镜像渲染，必须与后端权威配置逐字段一致；
 * 同时锁定付费透明口径：
 * - 当次实付与天数是唯一权威数字，「折合每 30 天」只是参考、不得超过实付；
 * - 90 天卡对比口径是「比连续购买三次 30 天卡省 ¥28」（¥87 → ¥59），
 *   不把 ¥87 标为季卡原价；
 * - 三档价格固定为 ¥29 / ¥59（主推）/ ¥169，手动续购不自动扣款。
 */
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_PLANS } from "../backend/src/membership/plans";
import {
  MEMBERSHIP_PLANS_STATIC,
  formatYuan,
  threeTimesMonthlyCents,
} from "@/lib/membership/plans";

describe("双端套餐配置一致", () => {
  it("套餐数量与顺序一致", () => {
    expect(MEMBERSHIP_PLANS_STATIC.map((p) => p.key)).toEqual(
      MEMBERSHIP_PLANS.map((p) => p.key)
    );
  });

  it.each(MEMBERSHIP_PLANS)("%s：逐字段一致", (backend) => {
    const frontend = MEMBERSHIP_PLANS_STATIC.find((p) => p.key === backend.key);
    expect(frontend).toBeDefined();
    expect(frontend).toMatchObject({
      days: backend.days,
      priceCents: backend.priceCents,
      label: backend.label,
      per30dReferenceCents: backend.per30dReferenceCents,
      featured: backend.featured,
    });
  });
});

describe("价格与透明口径锁定", () => {
  it("三档定价：30 天 ¥29 / 90 天 ¥59 主推 / 365 天 ¥169", () => {
    const byKey = Object.fromEntries(
      MEMBERSHIP_PLANS_STATIC.map((p) => [p.key, p])
    );
    expect(byKey["30d"].priceCents).toBe(2900);
    expect(byKey["90d"].priceCents).toBe(5900);
    expect(byKey["90d"].featured).toBe(true);
    expect(byKey["365d"].priceCents).toBe(16900);
  });

  it("折合每 30 天只是参考值：不得超过当次实付", () => {
    for (const plan of MEMBERSHIP_PLANS_STATIC) {
      expect(plan.per30dReferenceCents).toBeLessThanOrEqual(plan.priceCents);
    }
  });

  it("90 天卡对比口径：比连续购买三次 30 天卡省 ¥28（8700-5900=2800 分）", () => {
    expect(threeTimesMonthlyCents()).toBe(8700);
    expect(threeTimesMonthlyCents() - 5900).toBe(2800);
    expect(formatYuan(2800)).toBe("¥28");
  });

  it("formatYuan：整数去尾零，非整数保留两位", () => {
    expect(formatYuan(2900)).toBe("¥29");
    expect(formatYuan(1967)).toBe("¥19.67");
    expect(formatYuan(1389)).toBe("¥13.89");
  });
});
