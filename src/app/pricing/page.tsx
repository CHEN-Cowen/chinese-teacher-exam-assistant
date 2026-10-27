"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import {
  fetchMembershipPlans,
  type MembershipPlansDTO,
} from "@/lib/membership/api";
import {
  closePaymentOrder,
  createPaymentOrder,
  fetchPaymentOrder,
  simulateMockSuccess,
  startPayment,
  type PaymentOrderDTO,
} from "@/lib/payments/api";
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
 *
 * M12 购买流程（仅售卖开通后激活）：
 * - 下单/支付金额以后端订单为准（服务端定价）；
 * - mockChannel=true 时支付面板明确标识「模拟支付通道」，不冒充真实微信支付；
 * - 支付结果以后端订单状态为准：模拟成功/主动刷新都会向渠道查单补账。
 */
export default function PricingPage() {
  const [data, setData] = useState<MembershipPlansDTO | null>(null);
  const [activeOrder, setActiveOrder] = useState<PaymentOrderDTO | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [busy, setBusy] = useState(false);

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

  async function guard<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setPayError(null);
    try {
      return await action();
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        setNeedLogin(true);
      } else {
        setPayError(error instanceof Error ? error.message : "操作失败，请重试");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function buy(planKey: string) {
    const created = await guard(() => createPaymentOrder(planKey));
    if (!created) return;
    const paying = await guard(() => startPayment(created.id));
    setActiveOrder(paying ?? created);
  }

  async function refreshOrder() {
    if (!activeOrder) return;
    const latest = await guard(() => fetchPaymentOrder(activeOrder.id, true));
    if (latest) setActiveOrder(latest);
  }

  async function simulateSuccess() {
    if (!activeOrder) return;
    const result = await guard(() => simulateMockSuccess(activeOrder.id));
    if (!result) return;
    await refreshOrder();
  }

  async function cancelOrder() {
    if (!activeOrder) return;
    await guard(() => closePaymentOrder(activeOrder.id));
    setActiveOrder(null);
  }

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
              <button
                type="button"
                disabled={busy}
                onClick={() => void buy(plan.key)}
                className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
              >
                立即购买
              </button>
            ) : (
              <p className="text-center text-sm text-ink-muted">
                {plan.key === "365d" ? "暂未上架（待持续服务与商业确认就绪）" : "暂未开售"}
              </p>
            )}
          </Card>
        ))}
      </div>

      {needLogin && (
        <Callout variant="note" title="请先登录">
          购买会员需要登录账号，以便订单与权益绑定到你的账号。
          <Link href="/login" className="ml-1 font-medium text-brand underline">
            前往登录
          </Link>
        </Callout>
      )}
      {payError && <Callout variant="ask" title="操作未完成">{payError}</Callout>}

      {/* 支付面板（M12）：订单确认 + 渠道支付状态 */}
      {activeOrder && (
        <Card>
          <CardHeader
            title="确认订单"
            description={`订单号 ${activeOrder.id} · 价格版本 ${activeOrder.priceVersion}`}
          />
          {activeOrder.status === "paid" ? (
            <Callout variant="ok" title="支付成功，会员已到账">
              {activeOrder.planLabel}（{activeOrder.days} 天）已开通。
              <Link href="/me" className="ml-1 font-medium text-brand underline">
                前往「我的」查看会员状态
              </Link>
            </Callout>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-ink">
                {activeOrder.planLabel}：一次实付{" "}
                <span className="text-lg font-semibold">{formatYuan(activeOrder.amountCents)}</span>
                ，有效期 {activeOrder.days} 天
              </p>
              {activeOrder.mockChannel && (
                <Callout variant="ask" title="模拟支付通道">
                  当前未接入真实微信支付（商户资质待获批）。以下是支付链路的模拟验收通道，
                  不会产生任何真实扣款；正式开通后将替换为微信官方支付。
                </Callout>
              )}
              {activeOrder.prepay?.codeUrl && (
                <p className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink-muted">
                  {activeOrder.mockChannel ? "模拟扫码内容：" : "扫码链接："}
                  {activeOrder.prepay.codeUrl}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                {activeOrder.simulateAllowed && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void simulateSuccess()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
                  >
                    模拟支付成功
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshOrder()}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
                >
                  我已完成支付，刷新状态
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancelOrder()}
                  className="rounded-lg px-4 py-2 text-sm text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
                >
                  关闭订单
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                支付结果以后端订单状态为准；刷新状态会向支付渠道主动查单，不以前端页面跳转作为支付凭证。
              </p>
            </div>
          )}
        </Card>
      )}

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
