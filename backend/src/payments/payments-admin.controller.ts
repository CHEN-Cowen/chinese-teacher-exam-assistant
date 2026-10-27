/**
 * 支付售后与对账的管理员接口（M12）。
 * - 退款：仅全额，AdminGuard（工作人员）；部分退款在商业规则确认前不开放；
 * - 对账：拉取渠道日账单与本地渠道交易比对，差异落库（open），
 *   本控制器即「对账处理入口」——列表查看、填写处理结论闭环。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { AdminGuard } from '../auth/admin.guard.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

@Controller('admin/payments')
@UseGuards(AdminGuard)
export class PaymentsAdminController {
  constructor(private readonly service: PaymentsService) {}

  /** 订单全要素（售后排查：尝试/渠道交易/退款/回调事件/权益授予） */
  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.service.getOrderForAdmin(id);
  }

  /**
   * 发起退款（仅全额）。amountCents 缺省=订单实付；
   * 显式传入且不等于实付 → 400（部分退款不开放）。
   */
  @Post('orders/:id/refund')
  refund(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { amountCents?: number; reason?: string },
  ) {
    return this.service.requestRefund(req.user!.id, id, {
      amountCents: body?.amountCents,
      reason: body?.reason,
    });
  }

  /** 跑某日渠道账单对账（date=yyyy-mm-dd，UTC 口径） */
  @Post('reconciliation/run')
  runReconciliation(@Body() body: { date?: string }) {
    if (!body?.date) throw new BadRequestException('缺少对账日期 date');
    return this.service.runReconciliation(body.date);
  }

  /** 差异列表（默认全部；status=open/resolved 过滤） */
  @Get('reconciliation/records')
  listRecords(@Query('status') status?: string) {
    return this.service.listReconciliationRecords(status || undefined);
  }

  /** 处理差异：填写处理结论并闭环 */
  @Post('reconciliation/records/:id/resolve')
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { resolution?: string },
  ) {
    if (!body?.resolution) throw new BadRequestException('缺少处理结论 resolution');
    return this.service.resolveReconciliationRecord(id, req.user!.id, body.resolution);
  }
}
