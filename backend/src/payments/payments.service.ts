/**
 * 支付核心服务（M12）。
 *
 * 资金纪律（对应模块验收项）：
 * - 服务端定价：金额/天数/币种只取 plans.ts 套餐快照，客户端传价一律不采信；
 * - 回调先验签（渠道适配层），再核对商户号、订单、金额、币种，任一不符拒绝入账；
 * - 事务内幂等记账与发放：渠道交易（channelTransactionId 唯一）+ 权益发放
 *   （membership_grants.order_id 唯一）+ 订单状态在同一事务提交或整体回滚；
 * - 重复通知：eventId 幂等直接返回；乱序/超时后成功：closed 订单收到成功
 *   通知照常履约（钱已扣），订单回 paid；
 * - 补偿：事务内任何失败 → 事件标记 failed 并回 500 等渠道重推，重推时
 *   各步骤幂等，最终一致；
 * - 回跳不作为支付凭证；主动查单（queryOrder）是回调之外的第二凭证源；
 * - 退款仅全额；部分退款在商业规则确认前一律拒绝，不臆造权益扣减算法；
 * - 对账差异全部落 reconciliation_records（open），由人工处理入口闭环。
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { MembershipService } from '../membership/membership.service.js';
import {
  PRICE_VERSION,
  findPlan,
  isAnnualSalesOpen,
  isSalesOpen,
} from '../membership/plans.js';
import { getPaymentConfig } from './payment.config.js';
import {
  PAYMENT_CHANNEL,
  type ParsedChannelEvent,
  type PaymentChannel,
} from './channels/payment-channel.js';
import { MockWechatChannel } from './channels/mock-wechat.channel.js';

export type OrderStatus =
  | 'created'
  | 'paying'
  | 'paid'
  | 'closed'
  | 'refunded';

export interface OrderView {
  id: string;
  plan: string;
  planLabel: string;
  days: number;
  amountCents: number;
  currency: string;
  priceVersion: string;
  status: OrderStatus;
  channel: string;
  /** 是否模拟渠道：前端必须据此明确标识「模拟支付」 */
  mockChannel: boolean;
  /** 是否允许调用模拟支付端点（PAYMENT_MOCK_ENABLED 且为模拟渠道） */
  simulateAllowed: boolean;
  prepay: { codeUrl?: string; attemptId: string } | null;
  paidAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

export interface CallbackProcessResult {
  code: 'SUCCESS' | 'REJECTED';
  duplicate?: boolean;
  reason?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    @Inject(PAYMENT_CHANNEL) private readonly channel: PaymentChannel,
  ) {}

  // ---------- 用户侧 ----------

  /** 创建订单：服务端定价快照，客户端金额字段不采信 */
  async createOrder(userId: string, planKey: string): Promise<OrderView> {
    if (!isSalesOpen()) {
      throw new ForbiddenException('会员售卖暂未开通，无法创建订单');
    }
    const plan = findPlan(planKey);
    if (!plan) throw new BadRequestException(`未知会员套餐：${planKey}`);
    if (plan.key === '365d' && !isAnnualSalesOpen()) {
      throw new ForbiddenException('365 天卡暂未上架（待持续服务与商业确认就绪）');
    }
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        plan: plan.key,
        priceVersion: PRICE_VERSION,
        amountCents: plan.priceCents,
        currency: 'CNY',
        days: plan.days,
        status: 'created',
      },
    });
    return this.toView(order, null);
  }

  /** 发起支付：生成渠道预支付参数与一次支付尝试 */
  async startPayment(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.getOwnOrder(userId, orderId);
    if (order.status === 'paid' || order.status === 'refunded') {
      throw new BadRequestException('订单已支付，请勿重复发起');
    }
    if (order.status === 'closed') {
      throw new BadRequestException('订单已关闭，请重新下单');
    }
    const plan = findPlan(order.plan);
    const prepay = await this.channel.createPrepay({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      description: `教招有据会员 ${plan?.label ?? order.plan}`,
    });
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        channel: this.channel.name,
        channelOutTradeNo: prepay.channelOutTradeNo,
        status: 'created',
        prepayPayload: prepay.prepayPayload as Prisma.InputJsonValue,
      },
    });
    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'paying' },
    });
    return this.toView(
      { ...order, status: 'paying' },
      { attemptId: attempt.id, prepayPayload: prepay.prepayPayload },
    );
  }

  /**
   * 查询订单（用户刷新页面时主动同步）。
   * sync=true 且本地未到账时向渠道主动查单：渠道已付则按同一套
   * 幂等履约流程补账（回调丢失时的兜底，「主动查单」验收项）。
   */
  async getOrder(userId: string, orderId: string, sync: boolean): Promise<OrderView> {
    const order = await this.getOwnOrder(userId, orderId);
    if (sync && (order.status === 'created' || order.status === 'paying' || order.status === 'closed')) {
      const remote = await this.channel.queryOrder(order.id);
      if (remote.status === 'paid' && remote.channelTransactionId) {
        await this.fulfillFromQuery(order.id, {
          channelTransactionId: remote.channelTransactionId,
          amountCents: remote.amountCents ?? order.amountCents,
          currency: remote.currency ?? order.currency,
          paidAt: remote.paidAt ?? new Date().toISOString(),
        });
        return this.getOrder(userId, orderId, false);
      }
    }
    const latestAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'desc' }],
    });
    return this.toView(
      order,
      latestAttempt && (order.status === 'created' || order.status === 'paying')
        ? {
            attemptId: latestAttempt.id,
            prepayPayload: (latestAttempt.prepayPayload ?? {}) as Record<string, unknown>,
          }
        : null,
    );
  }

  /** 我的订单列表（个人中心对账用，最新在前） */
  async listMyOrders(userId: string): Promise<OrderView[]> {
    const orders = await this.prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
    });
    return orders.map((order) => this.toView(order, null));
  }

  /** 关闭未支付订单（用户关闭支付页面） */
  async closeOrder(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.getOwnOrder(userId, orderId);
    if (order.status !== 'created' && order.status !== 'paying') {
      throw new BadRequestException(`当前状态（${order.status}）不可关闭`);
    }
    const updated = await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    return this.toView(updated, null);
  }

  /**
   * 模拟支付成功（仅模拟渠道 + PAYMENT_MOCK_ENABLED）。
   * 走与真实渠道回调完全相同的验签→核对→事务履约链路，
   * 唯一区别是「渠道侧扣款」由内置账本产生，明确不代表真实资金。
   */
  async simulateMockPayment(userId: string, orderId: string): Promise<CallbackProcessResult> {
    const config = getPaymentConfig();
    if (!config.mockEnabled || !(this.channel instanceof MockWechatChannel)) {
      throw new NotFoundException('模拟支付端点未启用');
    }
    const order = await this.getOwnOrder(userId, orderId);
    if (order.status !== 'created' && order.status !== 'paying') {
      throw new BadRequestException(`当前状态（${order.status}）不可模拟支付`);
    }
    this.channel.notePaid({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
    });
    const callback = this.channel.buildPaymentSuccessCallback(order.id);
    return this.processCallback(this.channel.name, callback.headers, callback.body);
  }

  // ---------- 渠道回调 ----------

  /**
   * 处理渠道回调（验签 → 核对 → 事务内幂等记账与发放）。
   * 返回 SUCCESS（含重复通知幂等）或 REJECTED（业务校验失败，永久拒绝）；
   * 内部错误抛 500，等待渠道重推（重推时各步骤幂等）。
   */
  async processCallback(
    channelName: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: unknown,
  ): Promise<CallbackProcessResult> {
    if (channelName !== this.channel.name) {
      throw new NotFoundException(`未知支付渠道：${channelName}`);
    }
    const verified = this.channel.verifyAndParseCallback(headers, rawBody);
    if (!verified.ok) {
      // 验签失败不落库（报文不可信），日志留痕
      this.logger.warn(`支付回调验签失败：${verified.reason}`);
      throw new UnauthorizedException('回调验签失败');
    }
    const event = verified.event;

    // 事件幂等：已处理/已拒绝的重复通知直接返回；received/failed 允许重推补偿
    const existing = await this.prisma.paymentCallbackEvent.findUnique({
      where: { eventId: event.eventId },
    });
    if (existing && (existing.status === 'processed' || existing.status === 'rejected')) {
      return {
        code: existing.status === 'rejected' ? 'REJECTED' : 'SUCCESS',
        duplicate: true,
        reason: existing.rejectReason ?? undefined,
      };
    }
    if (!existing) {
      await this.prisma.paymentCallbackEvent.create({
        data: {
          channel: channelName,
          eventId: event.eventId,
          eventType: event.type,
          orderId: event.orderId,
          signatureValid: true,
          status: 'received',
          payload: rawBody as Prisma.InputJsonValue,
        },
      });
    }

    try {
      const result = await this.dispatchEvent(event, rawBody);
      return result;
    } catch (error) {
      // 内部错误：标记 failed 等渠道重推；不重推业务校验拒绝（那走 REJECTED）
      await this.markEvent(event.eventId, 'failed');
      this.logger.error(
        `支付回调处理失败（事件 ${event.eventId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException('回调处理失败，请渠道重试');
    }
  }

  /** 业务校验与履约分发。业务拒绝返回 REJECTED 并落原因，不抛错（不触发重推）。 */
  private async dispatchEvent(
    event: ParsedChannelEvent,
    rawBody: unknown,
  ): Promise<CallbackProcessResult> {
    if (event.mchId !== this.channel.mchId) {
      return this.rejectEvent(event.eventId, 'mch_mismatch');
    }
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: event.orderId },
    });
    if (!order) {
      return this.rejectEvent(event.eventId, 'order_not_found');
    }
    if (event.amountCents !== order.amountCents) {
      return this.rejectEvent(event.eventId, 'amount_mismatch');
    }
    if (event.currency !== order.currency) {
      return this.rejectEvent(event.eventId, 'currency_mismatch');
    }

    if (event.type === 'payment.success') {
      if (!event.channelTransactionId) {
        return this.rejectEvent(event.eventId, 'missing_transaction_id');
      }
      await this.fulfillPaid(event, order as OrderRow, rawBody);
      return { code: 'SUCCESS' };
    }

    // refund.success / refund.failed
    const refund = await this.prisma.refund.findFirst({
      where: { orderId: order.id, status: 'requested' },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (!refund) {
      return this.rejectEvent(event.eventId, 'refund_not_found');
    }
    await this.settleRefund(event, order as OrderRow, refund.id, rawBody);
    return { code: 'SUCCESS' };
  }

  /**
   * 支付成功履约（事务内：渠道交易 + 权益发放 + 订单状态 + 事件状态）。
   * 已 paid 的订单重复通知（新 eventId）直接标记事件 processed，不重复记账。
   * closed 订单收到成功通知照常履约（超时后成功：钱已扣必须发放权益）。
   */
  private async fulfillPaid(
    event: ParsedChannelEvent,
    order: OrderRow,
    rawBody: unknown,
  ): Promise<void> {
    if (order.status === 'paid' || order.status === 'refunded') {
      await this.markEvent(event.eventId, 'processed');
      return;
    }
    const paidAt = event.paidAt ? new Date(event.paidAt) : new Date();
    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.channelTransaction.create({
          data: {
            orderId: order.id,
            channel: this.channel.name,
            channelTransactionId: event.channelTransactionId!,
            amountCents: event.amountCents,
            currency: event.currency,
            status: 'success',
            paidAt,
            rawPayload: rawBody as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // 渠道交易号唯一冲突 = 该笔交易已记账（乱序/重复），后续步骤幂等补齐
        if (!isUniqueViolation(error)) throw error;
      }
      const plan = findPlan(order.plan);
      if (!plan) throw new Error(`订单 ${order.id} 套餐配置已失效：${order.plan}`);
      const grant = await this.membership.issueGrant({
        userId: order.userId,
        plan: plan.key,
        source: 'payment',
        orderId: order.id,
        now: paidAt,
        tx,
      });
      await tx.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt, closedAt: null, grantId: grant.id },
      });
      await tx.paymentAttempt.updateMany({
        where: { orderId: order.id, status: 'created' },
        data: { status: 'success' },
      });
      await tx.paymentCallbackEvent.update({
        where: { eventId: event.eventId },
        data: { status: 'processed', processedAt: new Date() },
      });
    });
  }

  /** 主动查单补账：渠道返回已支付而本地未到账时，以查单结果为凭证履约 */
  private async fulfillFromQuery(
    orderId: string,
    query: {
      channelTransactionId: string;
      amountCents: number;
      currency: string;
      paidAt: string;
    },
  ): Promise<void> {
    const syntheticEvent: ParsedChannelEvent = {
      eventId: `query-${query.channelTransactionId}`,
      type: 'payment.success',
      orderId,
      mchId: this.channel.mchId,
      amountCents: query.amountCents,
      currency: query.currency,
      channelTransactionId: query.channelTransactionId,
      paidAt: query.paidAt,
    };
    const existing = await this.prisma.paymentCallbackEvent.findUnique({
      where: { eventId: syntheticEvent.eventId },
    });
    if (existing) return; // 同一笔交易的查单补账只做一次
    await this.prisma.paymentCallbackEvent.create({
      data: {
        channel: this.channel.name,
        eventId: syntheticEvent.eventId,
        eventType: syntheticEvent.type,
        orderId,
        signatureValid: true,
        status: 'received',
        payload: { source: 'active_query', query } as Prisma.InputJsonValue,
      },
    });
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      await this.rejectEvent(syntheticEvent.eventId, 'order_not_found');
      return;
    }
    if (order.amountCents !== query.amountCents || order.currency !== query.currency) {
      await this.rejectEvent(syntheticEvent.eventId, 'amount_mismatch');
      return;
    }
    await this.fulfillPaid(syntheticEvent, order as OrderRow, {
      source: 'active_query',
      query,
    });
  }

  /** 退款结果结算（事务内：退款状态 + 订单状态 + 权益回收 + 事件状态） */
  private async settleRefund(
    event: ParsedChannelEvent,
    order: OrderRow,
    refundId: string,
    rawBody: unknown,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (event.type === 'refund.success') {
        await tx.refund.update({
          where: { id: refundId },
          data: {
            status: 'succeeded',
            channelRefundId: event.channelRefundId ?? null,
            entitlementAction: 'revoked',
            rawPayload: rawBody as Prisma.InputJsonValue,
          },
        });
        await tx.paymentOrder.update({
          where: { id: order.id },
          data: { status: 'refunded' },
        });
        // 全额退款成功：回收该订单产生的授予（确定性逆向操作；
        // 不涉及任何按比例扣减的臆造算法）
        await tx.membershipGrant.updateMany({
          where: { orderId: order.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } else {
        await tx.refund.update({
          where: { id: refundId },
          data: {
            status: 'failed',
            channelRefundId: event.channelRefundId ?? null,
            rawPayload: rawBody as Prisma.InputJsonValue,
          },
        });
      }
      await tx.paymentCallbackEvent.update({
        where: { eventId: event.eventId },
        data: { status: 'processed', processedAt: new Date() },
      });
    });
  }

  // ---------- 售后：退款（管理员） ----------

  /**
   * 发起退款（仅全额）。
   * 部分退款：商业规则（已消耗权益如何折算）未确认前一律 400 拒绝，
   * 不臆造扣权益算法，也不开放不受控的部分退款入口。
   */
  async requestRefund(
    adminId: string,
    orderId: string,
    input: { amountCents?: number; reason?: string },
  ): Promise<{ refundId: string; status: string }> {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'paid') {
      throw new BadRequestException(`当前状态（${order.status}）不可退款`);
    }
    if (input.amountCents !== undefined && input.amountCents !== order.amountCents) {
      throw new BadRequestException(
        '仅支持全额退款：部分退款的权益处置规则尚未与商业确认，暂不开放',
      );
    }
    const existing = await this.prisma.refund.findFirst({
      where: { orderId, status: { in: ['requested', 'succeeded'] } },
    });
    if (existing) {
      throw new BadRequestException('该订单已有进行中或已成功的退款，请勿重复发起');
    }
    const txn = await this.prisma.channelTransaction.findFirst({
      where: { orderId, status: 'success' },
    });
    if (!txn) throw new BadRequestException('未找到渠道成功交易，无法原路退款');

    const refund = await this.prisma.refund.create({
      data: {
        orderId,
        channel: this.channel.name,
        amountCents: order.amountCents,
        currency: order.currency,
        status: 'requested',
        reason: input.reason ?? null,
        requestedBy: adminId,
      },
    });
    const receipt = await this.channel.requestRefund({
      orderId,
      channelTransactionId: txn.channelTransactionId,
      amountCents: order.amountCents,
      currency: order.currency,
      reason: input.reason,
    });
    if (!receipt.accepted) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'failed',
          rawPayload: { failureReason: receipt.failureReason ?? 'channel_rejected' },
        },
      });
      return { refundId: refund.id, status: 'failed' };
    }
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { channelRefundId: receipt.channelRefundId ?? null },
    });

    // 模拟渠道：退款结果通知由渠道账本立即「送达」（仍走完整验签回调链路）；
    // 真实渠道为异步 POST，由支付服务商触发，无此捷径。
    const config = getPaymentConfig();
    if (config.mockEnabled && this.channel instanceof MockWechatChannel) {
      const callback = this.channel.buildRefundCallback({
        orderId,
        success: this.channel.peekRefundOutcome() === 'success',
        amountCents: order.amountCents,
        currency: order.currency,
      });
      await this.processCallback(this.channel.name, callback.headers, callback.body);
    }
    const latest = await this.prisma.refund.findUnique({ where: { id: refund.id } });
    return { refundId: refund.id, status: latest?.status ?? 'requested' };
  }

  /** 管理员查看订单全要素（售后与对账排查入口） */
  async getOrderForAdmin(orderId: string) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const [attempts, transactions, refunds, events, grants] = await Promise.all([
      this.prisma.paymentAttempt.findMany({ where: { orderId } }),
      this.prisma.channelTransaction.findMany({ where: { orderId } }),
      this.prisma.refund.findMany({ where: { orderId } }),
      this.prisma.paymentCallbackEvent.findMany({ where: { orderId } }),
      this.prisma.membershipGrant.findMany({ where: { orderId } }),
    ]);
    return { order, attempts, transactions, refunds, events, grants };
  }

  // ---------- 对账（管理员） ----------

  /**
   * 跑某日的渠道账单对账。差异落 reconciliation_records（dedupeKey 幂等，
   * 重跑不产生重复差异），全部 open 等人工处理。
   */
  async runReconciliation(date: string): Promise<{
    date: string;
    channelEntries: number;
    localEntries: number;
    newDiffs: number;
  }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('日期格式应为 yyyy-mm-dd');
    }
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [bill, local] = await Promise.all([
      this.channel.fetchDailyBill(date),
      this.prisma.channelTransaction.findMany({
        where: {
          channel: this.channel.name,
          paidAt: { gte: dayStart, lt: dayEnd },
        },
      }),
    ]);
    const localByTxn = new Map(local.map((row) => [row.channelTransactionId, row]));
    const billByTxn = new Map(bill.map((entry) => [entry.channelTransactionId, entry]));

    const diffs: Array<{
      type: string;
      orderId: string | null;
      channelTransactionId: string | null;
      localAmountCents: number | null;
      channelAmountCents: number | null;
    }> = [];
    for (const entry of bill) {
      const localRow = localByTxn.get(entry.channelTransactionId);
      if (!localRow) {
        diffs.push({
          type: 'missing_local',
          orderId: entry.orderId,
          channelTransactionId: entry.channelTransactionId,
          localAmountCents: null,
          channelAmountCents: entry.amountCents,
        });
      } else if (localRow.amountCents !== entry.amountCents) {
        diffs.push({
          type: 'amount_mismatch',
          orderId: entry.orderId,
          channelTransactionId: entry.channelTransactionId,
          localAmountCents: localRow.amountCents,
          channelAmountCents: entry.amountCents,
        });
      }
    }
    for (const row of local) {
      if (!billByTxn.has(row.channelTransactionId)) {
        diffs.push({
          type: 'missing_channel',
          orderId: row.orderId,
          channelTransactionId: row.channelTransactionId,
          localAmountCents: row.amountCents,
          channelAmountCents: null,
        });
      }
    }

    let newDiffs = 0;
    for (const diff of diffs) {
      const dedupeKey = `${date}|${this.channel.name}|${diff.type}|${diff.channelTransactionId ?? diff.orderId}`;
      const existing = await this.prisma.reconciliationRecord.findUnique({
        where: { dedupeKey },
      });
      if (existing) continue;
      await this.prisma.reconciliationRecord.create({
        data: {
          date,
          channel: this.channel.name,
          type: diff.type,
          dedupeKey,
          orderId: diff.orderId,
          channelTransactionId: diff.channelTransactionId,
          localAmountCents: diff.localAmountCents,
          channelAmountCents: diff.channelAmountCents,
          status: 'open',
        },
      });
      newDiffs += 1;
    }
    return { date, channelEntries: bill.length, localEntries: local.length, newDiffs };
  }

  async listReconciliationRecords(status?: string) {
    return this.prisma.reconciliationRecord.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
  }

  /** 处理差异：记录处理结论与处理人（对账处理入口） */
  async resolveReconciliationRecord(id: string, adminId: string, resolution: string) {
    const record = await this.prisma.reconciliationRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('对账差异不存在');
    if (record.status !== 'open') {
      throw new BadRequestException('该差异已处理，请勿重复操作');
    }
    if (!resolution.trim()) {
      throw new BadRequestException('必须填写处理结论');
    }
    return this.prisma.reconciliationRecord.update({
      where: { id },
      data: {
        status: 'resolved',
        resolution,
        resolvedBy: adminId,
        resolvedAt: new Date(),
      },
    });
  }

  // ---------- 内部 ----------

  private async getOwnOrder(userId: string, orderId: string) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
    // 存在性不外泄：他人订单与不存在订单同样 404
    if (!order || order.userId !== userId) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  private async rejectEvent(
    eventId: string,
    reason: string,
  ): Promise<CallbackProcessResult> {
    await this.prisma.paymentCallbackEvent.update({
      where: { eventId },
      data: { status: 'rejected', rejectReason: reason, processedAt: new Date() },
    });
    this.logger.warn(`支付回调业务校验拒绝（${eventId}）：${reason}`);
    return { code: 'REJECTED', reason };
  }

  private async markEvent(eventId: string, status: string): Promise<void> {
    await this.prisma.paymentCallbackEvent
      .update({
        where: { eventId },
        data: { status, processedAt: status === 'failed' ? null : new Date() },
      })
      .catch(() => undefined);
  }

  private toView(
    order: {
      id: string;
      plan: string;
      amountCents: number;
      currency: string;
      days: number;
      priceVersion: string;
      status: string;
      paidAt: Date | null;
      closedAt: Date | null;
      createdAt: Date;
    },
    prepay: { attemptId: string; prepayPayload: Record<string, unknown> } | null,
  ): OrderView {
    const config = getPaymentConfig();
    const mockChannel = this.channel.name === 'wechat_mock';
    const plan = findPlan(order.plan);
    return {
      id: order.id,
      plan: order.plan,
      planLabel: plan?.label ?? order.plan,
      days: order.days,
      amountCents: order.amountCents,
      currency: order.currency,
      priceVersion: order.priceVersion,
      status: order.status as OrderStatus,
      channel: this.channel.name,
      mockChannel,
      simulateAllowed: config.mockEnabled && mockChannel,
      prepay: prepay
        ? {
            attemptId: prepay.attemptId,
            codeUrl:
              typeof prepay.prepayPayload.codeUrl === 'string'
                ? prepay.prepayPayload.codeUrl
                : undefined,
          }
        : null,
      paidAt: order.paidAt,
      closedAt: order.closedAt,
      createdAt: order.createdAt,
    };
  }
}

/** Prisma 唯一约束冲突（P2002） */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** paymentOrder.findUnique 返回行（本服务内使用的字段子集） */
interface OrderRow {
  id: string;
  userId: string;
  plan: string;
  amountCents: number;
  currency: string;
  status: string;
}
