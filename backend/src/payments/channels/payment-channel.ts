/**
 * 支付渠道适配层接口（M12）。
 *
 * 设计动机：微信支付真实接入依赖商户资质、API 证书与已备案域名，
 * 当前均未配置（受阻项如实记录在执行日志）。适配层把「渠道行为」收敛为
 * 一组显式接口：业务链路（下单/验签/记账/发放/退款/对账）只依赖本接口，
 * 真实微信渠道（Native/JSAPI/H5，按实际获批权限三选一）获批后实现同一接口接入，
 * 业务代码不变。
 *
 * 与真实微信支付的对应关系：
 * - createPrepay  ≈ Native/JSAPI 下单（返回 codeUrl / 调起参数）；
 * - verifyAndParseCallback ≈ 支付/退款结果通知的验签与解密
 *   （真实微信为平台证书 RSA 验签 + AEAD 解密；模拟渠道用 HMAC 共享密钥
 *   演练同一流程，签名方案不同，验签纪律相同：不过验签一律不信任）；
 * - queryOrder    ≈ 主动查单（微信支付单查询），回调丢失时的补账手段；
 * - requestRefund ≈ 退款申请；fetchDailyBill ≈ 下载交易账单用于对账。
 *
 * 纪律：浏览器回跳（return_url）不作为支付凭证；唯一凭证是验签后的
 * 渠道通知与主动查单结果。
 */

/** 渠道侧成功扣款事件 / 退款结果事件 */
export interface ParsedChannelEvent {
  /** 渠道事件唯一 ID（幂等键） */
  eventId: string;
  type: 'payment.success' | 'refund.success' | 'refund.failed';
  /** 商户侧订单号（= PaymentOrder.id，对应微信 out_trade_no） */
  orderId: string;
  /** 商户号：回调必须核对为本系统配置商户号，防串号 */
  mchId: string;
  amountCents: number;
  currency: string;
  /** 渠道交易号（payment.success 必有） */
  channelTransactionId?: string;
  /** 渠道退款单号（refund.* 必有） */
  channelRefundId?: string;
  paidAt?: string;
}

export type VerifyCallbackResult =
  | { ok: true; event: ParsedChannelEvent }
  | { ok: false; reason: string };

export interface ChannelPrepayResult {
  channelOutTradeNo: string;
  /** 交给前端的调起参数；模拟渠道为 { codeUrl }，真实 JSAPI 为调起签名包 */
  prepayPayload: Record<string, unknown>;
}

export interface ChannelOrderQuery {
  status: 'paid' | 'not_paid';
  channelTransactionId?: string;
  amountCents?: number;
  currency?: string;
  paidAt?: string;
}

export interface ChannelRefundReceipt {
  /** 渠道是否受理（受理≠成功，最终结果以 refund.* 回调为准） */
  accepted: boolean;
  channelRefundId?: string;
  failureReason?: string;
}

/** 渠道交易账单条目（对账的渠道侧依据） */
export interface ChannelBillEntry {
  channelTransactionId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
}

export interface PaymentChannel {
  /** 渠道标识：wechat_mock / wechat_native / wechat_jsapi / wechat_h5 */
  readonly name: string;
  /** 本系统在该渠道的商户号；回调事件 mchId 必须与之相等 */
  readonly mchId: string;

  createPrepay(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<ChannelPrepayResult>;

  /**
   * 验签并解析渠道回调。rawBody 为报文原文（真实微信验签需要），
   * 模拟渠道按字段规范化串验签。验签失败必须返回 ok:false，不得放行。
   */
  verifyAndParseCallback(
    headers: Record<string, string | string[] | undefined>,
    rawBody: unknown,
  ): VerifyCallbackResult;

  /** 主动查单（回调丢失/超时后的补账手段） */
  queryOrder(orderId: string): Promise<ChannelOrderQuery>;

  requestRefund(input: {
    orderId: string;
    channelTransactionId: string;
    amountCents: number;
    currency: string;
    reason?: string;
  }): Promise<ChannelRefundReceipt>;

  /** 拉取某日渠道交易账单（对账） */
  fetchDailyBill(date: string): Promise<ChannelBillEntry[]>;
}

export const PAYMENT_CHANNEL = Symbol('PAYMENT_CHANNEL');
