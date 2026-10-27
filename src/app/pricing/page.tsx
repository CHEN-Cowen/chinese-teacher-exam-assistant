"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import {
  fetchMembershipPlans,
  type MembershipPlansDTO,
} from "@/lib/membership/api";
import { formatYuan, threeTimesMonthlyCents } from "@/lib/membership/plans";
import { cn } from "@/lib/utils";

/**
 * 价格页（M11 / 整体方案 11.5、11.6）：付款前看清楚。
 *
 * 透明口径（tests/membership-parity.test.ts 锁定）：
 * - 当次实付与天数是唯一权威数字；「折合每 30 天」只是比较参考，不是扣款额；
 * - 90 天卡对比写「比连续购买三次 30 天卡省 ¥28」，不把 ¥87 标为季卡原价；
 * - 365 天年卡未完成商业确认前标注「暂未上架」；
 * - 拟开发权益（多方案/对比/批量/导出/离站通知）未上线前不列为已可用权益；
 * - 售卖总开关默认关闭：只展示价格与权益说明，不产生订单。
 */
export default function PricingPage() {
  const [data, setData] = useState<MembershipPlansDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMembershipPlans().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const plans = data?.plans ?? [];
  const savingsCents = threeTimesMonthlyCents() - 5900;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-4">
      <header>
        <p className="text-xs font-semibold tracking-wide text-brand">价格</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          会员套餐
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          一次付费、限期使用，手动续购，不自动扣款
        </p>
      </header>

      {data && !data.salesOpen && (
        <Callout variant="note" title="售卖暂未开通">
          目前没有已验收的付费增值功能，全部已上线能力免费开放。
          以下价格仅供了解，暂不能购买；付费功能验收通过并开放售卖后才会产生订单。
        </Callout>
      )}

      {/* 三档套餐 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.key}
            className={cn(
              "relative flex flex-col",
              plan.featured && "border-brand/40 shadow-[0_12px_36px_rgba(30,64,120,0.10)]"
            )}
          >
            {plan.featured && (
              <Badge variant="primary" className="absolute -top-2.5 left-4">
                主推
              </Badge>
            )}
            <p className="text-sm font-semibold text-ink">{plan.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">
              {formatYuan(plan.priceCents)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              一次实付 {formatYuan(plan.priceCents)}，有效期 {plan.days} 天
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              折合每 30 天约 {formatYuan(plan.per30dReferenceCents)}
              <span className="text-ink-muted/70">（仅作比较参考，非当次扣款额）</span>
            </p>
            {plan.key === "90d" && (
              <p className="mt-2 text-xs font-medium text-success">
                比连续购买三次 30 天卡省 {formatYuan(savingsCents)}
              </p>
            )}
            <div className="mt-4 flex-1" />
            {plan.purchasable ? (
              <p className="text-center text-sm text-ink-muted">购买入口即将开放</p>
            ) : (
              <p className="text-center text-sm text-ink-muted">
                {plan.key === "365d" ? "暂未上架（待持续服务与商业确认就绪）" : "暂未开售"}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* 权益矩阵 */}
      <Card>
        <CardHeader
          title="权益说明"
          description="免费层与会员共享全部已上线能力；付费权益验收通过前不售卖"
        />
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-ink">当前全部功能免费开放</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-ink-muted">
              <li>公告与来源原文、基础资格预筛</li>
              <li>不符项与不确定项说明、定向补充材料</li>
              <li>基础收藏、站内日程与重大变更提示</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-ink">拟开发的会员权益（尚未上线，未验收前不售卖）</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-ink-muted">
              <li>多方案并行管理、机会对比</li>
              <li>批量操作、数据导出</li>
              <li>离站通知（邮件/短信等站外渠道）</li>
            </ul>
            <p className="mt-2 text-xs text-ink-muted">
              以上权益仍在开发中，未实现并验收前不会列为已可用权益，也不会先收费。
            </p>
          </div>
        </div>
      </Card>

      {/* 购买前须知 */}
      <Card>
        <CardHeader title="付款前请确认" />
        <ul className="list-inside list-disc space-y-1.5 text-sm text-ink-muted">
          <li>当次实付金额与有效天数以套餐卡片为准；「折合每 30 天」仅为比较参考，不是当次扣款额。</li>
          <li>手动续购，到期不自动扣款；未到期续购从原到期时间顺延，不吃亏。</li>
          <li>会员到期后，你的个人资料、收藏与历史成果全部保留，仅会员权益失效。</li>
          <li>三个付费期限共享同一组已上线软件权益，区别只在有效期与价格。</li>
        </ul>
      </Card>

      {/* 售后 */}
      <Card>
        <CardHeader title="退款与售后" />
        <p className="text-sm leading-6 text-ink-muted">
          支付未到账或权益未开通：保留支付凭证，通过「我的 → 资料与设置」中的反馈入口联系我们，
          核实后补发权益或原路退款。已开通的限期权益不支持中途退款，
          但未到期续购顺延、到期后资料保留，不会因到期造成任何数据损失。
        </p>
      </Card>
    </div>
  );
}
