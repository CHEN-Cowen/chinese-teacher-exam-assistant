/**
 * 模拟微信支付渠道（M12）。
 *
 * 存在理由：真实微信支付需要商户号、APIv3 密钥、平台证书与已备案回调域名，
 * 当前均未获批（真实支付受阻项，见执行日志 M12 行）。本渠道用 HMAC 共享密钥
 * 演练与真实渠道相同的纪律：预支付下单、通知验签（含时间窗防重放）、
 * 主动查单、退款异步回调、日账单对账。
 *
 * 诚实边界：
 * - 本渠道的「支付成功」由内置账本产生，不代表任何真实资金流动；
 * - 前端必须把 mock 支付面板明确标识为「模拟支付通道」；
 * - PAYMENT_CHANNEL 配置为真实渠道但未配齐资质时，系统拒绝启动支付链路，
 *   不得以模拟结果冒充真实支付验收（见 payment.config.ts）。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ChannelBillEntry,
  ChannelOrderQuery,
  ChannelPrepayResult,
  ChannelRefundReceipt,
  ParsedChannelEvent,
  PaymentChannel,
  VerifyCallbackResult,
} from './payment-channel.js';

/** 回调签名时间窗（秒）：超出窗口视为重放/过期，拒绝 */
const SIGNATURE_WINDOW_SECONDS = 300;

interface MockLedgerEntry {
  channelTransactionId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  paidAt: Date;
}

interface MockRefundEntry {
  channelRefundId: string;
  orderId: string;
  amountCents: number;
  requestedAt: Date;
}

/** 回调报文结构（模拟渠道的「渠道报文」） */
export interface MockCallbackBody {
  eventId: string;
  type: ParsedChannelEvent['type'];
  orderId: string;
  mchId: string;
  amountCents: number;
  currency: string;
  channelTransactionId?: string;
  channelRefundId?: string;
  paidAt?: string;
}

export class MockWechatChannel implements PaymentChannel {
  readonly name = 'wechat_mock';

  /** 渠道侧账本：记录「已扣款」的订单（模拟渠道服务端状态） */
  private readonly ledger = new Map<string, MockLedgerEntry>();
  private readonly refunds = new Map<string, MockRefundEntry>();
  private txnSeq = 0;
  private refundSeq = 0;
  /** 测试/演示注入：下一次退款是否被渠道拒绝受理 */
  private nextRefundAccepted = true;
  /** 测试/演示注入：下一次已受理退款的结果回调（成功/失败） */
  private nextRefundOutcome: 'success' | 'failed' = 'success';

  constructor(
    readonly mchId: string,
    private readonly secret: string,
  ) {}

  /** 规范化签名串：字段定序拼接，覆盖全部关键资金字段 */
  private canonical(body: MockCallbackBody, timestamp: string): string {
    return [
      body.eventId,
      body.type,
      body.orderId,
      body.mchId,
      String(body.amountCents),
      body.currency,
      body.channelTransactionId ?? '',
      body.channelRefundId ?? '',
      body.paidAt ?? '',
      timestamp,
    ].join('\n');
  }

  private sign(body: MockCallbackBody, timestamp: string): string {
    return createHmac('sha256', this.secret)
      .update(this.canonical(body, timestamp))
      .digest('hex');
  }

  // ---------- 渠道服务端行为（仅 mock 拥有：真实渠道由微信支付侧完成） ----------

  /** 模拟用户在渠道侧完成支付（产生渠道账本记录；不代表真实资金） */
  notePaid(input: { orderId: string; amountCents: number; currency: string; paidAt?: Date }): MockLedgerEntry {
    const entry: MockLedgerEntry = {
      channelTransactionId: `mocktxn_${++this.txnSeq}_${randomUUID().slice(0, 8)}`,
      orderId: input.orderId,
      amountCents: input.amountCents,
      currency: input.currency,
      paidAt: input.paidAt ?? new Date(),
    };
    this.ledger.set(input.orderId, entry);
    return entry;
  }

  /** 构造一份带有效签名的支付成功通知（等价于渠道服务器 POST 回调） */
  buildPaymentSuccessCallback(orderId: string): {
    headers: Record<string, string>;
    body: MockCallbackBody;
  } {
    const entry = this.ledger.get(orderId);
    if (!entry) throw new Error(`模拟渠道无此扣款记录：${orderId}`);
    const body: MockCallbackBody = {
      eventId: `evt_${randomUUID()}`,
      type: 'payment.success',
      orderId,
      mchId: this.mchId,
      amountCents: entry.amountCents,
      currency: entry.currency,
      channelTransactionId: entry.channelTransactionId,
      paidAt: entry.paidAt.toISOString(),
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      headers: {
        'x-mock-timestamp': timestamp,
        'x-mock-signature': this.sign(body, timestamp),
      },
      body,
    };
  }

  /** 构造一份带有效签名的退款结果通知 */
  buildRefundCallback(input: {
    orderId: string;
    success: boolean;
    amountCents: number;
    currency: string;
  }): { headers: Record<string, string>; body: MockCallbackBody } {
    const refund = this.refunds.get(input.orderId);
    const body: MockCallbackBody = {
      eventId: `evt_${randomUUID()}`,
      type: input.success ? 'refund.success' : 'refund.failed',
      orderId: input.orderId,
      mchId: this.mchId,
      amountCents: input.amountCents,
      currency: input.currency,
      channelRefundId: refund?.channelRefundId,
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      headers: {
        'x-mock-timestamp': timestamp,
        'x-mock-signature': this.sign(body, timestamp),
      },
      body,
    };
  }

  /** 测试注入：控制下一次退款申请是否被渠道受理 */
  setNextRefundAccepted(accepted: boolean): void {
    this.nextRefundAccepted = accepted;
  }

  /** 测试注入：控制下一次已受理退款的结果回调 */
  setNextRefundOutcome(outcome: 'success' | 'failed'): void {
    this.nextRefundOutcome = outcome;
  }

  /** 读取并复位下一次退款结果（服务层模拟渠道即时送达回调时使用） */
  peekRefundOutcome(): 'success' | 'failed' {
    const outcome = this.nextRefundOutcome;
    this.nextRefundOutcome = 'success';
    return outcome;
  }

  // ---------- PaymentChannel 接口实现 ----------

  async createPrepay(input: {
    orderId: string;
    amountCents: number;
    currency: string;
    description: string;
  }): Promise<ChannelPrepayResult> {
    const outTradeNo = input.orderId;
    return {
      channelOutTradeNo: outTradeNo,
      prepayPayload: {
        // 模拟扫码链接：前端展示为「模拟支付二维码」文本，明确非真实支付
        codeUrl: `mock://wechat/pay/${outTradeNo}?amount=${input.amountCents}`,
        mockChannel: true,
      },
    };
  }

  verifyAndParseCallback(
    headers: Record<string, string | string[] | undefined>,
    rawBody: unknown,
  ): VerifyCallbackResult {
    const timestampRaw = headers['x-mock-timestamp'];
    const signatureRaw = headers['x-mock-signature'];
    const timestamp = Array.isArray(timestampRaw) ? timestampRaw[0] : timestampRaw;
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;
    if (!timestamp || !signature) {
      return { ok: false, reason: 'missing_signature_headers' };
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_WINDOW_SECONDS) {
      return { ok: false, reason: 'timestamp_out_of_window' };
    }
    const body = rawBody as MockCallbackBody;
    if (!body || typeof body !== 'object' || !body.eventId || !body.type) {
      return { ok: false, reason: 'malformed_body' };
    }
    const expected = this.sign(body, timestamp);
    const providedBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: false, reason: 'signature_mismatch' };
    }
    return {
      ok: true,
      event: {
        eventId: body.eventId,
        type: body.type,
        orderId: body.orderId,
        mchId: body.mchId,
        amountCents: body.amountCents,
        currency: body.currency,
        channelTransactionId: body.channelTransactionId,
        channelRefundId: body.channelRefundId,
        paidAt: body.paidAt,
      },
    };
  }

  async queryOrder(orderId: string): Promise<ChannelOrderQuery> {
    const entry = this.ledger.get(orderId);
    if (!entry) return { status: 'not_paid' };
    return {
      status: 'paid',
      channelTransactionId: entry.channelTransactionId,
      amountCents: entry.amountCents,
      currency: entry.currency,
      paidAt: entry.paidAt.toISOString(),
    };
  }

  async requestRefund(input: {
    orderId: string;
    channelTransactionId: string;
    amountCents: number;
    currency: string;
    reason?: string;
  }): Promise<ChannelRefundReceipt> {
    if (!this.nextRefundAccepted) {
      this.nextRefundAccepted = true;
      return { accepted: false, failureReason: 'mock_channel_rejected' };
    }
    if (!this.ledger.has(input.orderId)) {
      return { accepted: false, failureReason: 'channel_transaction_not_found' };
    }
    const channelRefundId = `mockrefund_${++this.refundSeq}_${randomUUID().slice(0, 8)}`;
    this.refunds.set(input.orderId, {
      channelRefundId,
      orderId: input.orderId,
      amountCents: input.amountCents,
      requestedAt: new Date(),
    });
    return { accepted: true, channelRefundId };
  }

  async fetchDailyBill(date: string): Promise<ChannelBillEntry[]> {
    return [...this.ledger.values()]
      .filter((entry) => entry.paidAt.toISOString().slice(0, 10) === date)
      .map((entry) => ({
        channelTransactionId: entry.channelTransactionId,
        orderId: entry.orderId,
        amountCents: entry.amountCents,
        currency: entry.currency,
        paidAt: entry.paidAt.toISOString(),
      }));
  }
}
