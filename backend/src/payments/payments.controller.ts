/**
 * 用户侧支付接口（M12）。
 * 全部需登录；订单归属在服务端校验（他人订单一律 404，存在性不外泄）。
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
import { UserGuard } from '../opportunities/user.guard.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

@Controller('payments')
@UseGuards(UserGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  /** 创建订单（服务端定价；客户端传价不采信） */
  @Post('orders')
  createOrder(@Req() req: AuthenticatedRequest, @Body() body: { plan?: string }) {
    if (!body?.plan || typeof body.plan !== 'string') {
      throw new BadRequestException('缺少套餐参数 plan');
    }
    return this.service.createOrder(req.user!.id, body.plan);
  }

  /** 我的订单列表（最新在前） */
  @Get('orders')
  listMyOrders(@Req() req: AuthenticatedRequest) {
    return this.service.listMyOrders(req.user!.id);
  }

  /** 查询订单；sync=1 时向渠道主动查单补账（回调丢失兜底） */
  @Get('orders/:id')
  getOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('sync') sync?: string,
  ) {
    return this.service.getOrder(req.user!.id, id, sync === '1' || sync === 'true');
  }

  /** 发起支付：返回渠道预支付参数（模拟渠道为 codeUrl） */
  @Post('orders/:id/pay')
  pay(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.startPayment(req.user!.id, id);
  }

  /** 关闭未支付订单（用户关闭支付页面） */
  @Post('orders/:id/close')
  close(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.closeOrder(req.user!.id, id);
  }

  /**
   * 模拟支付成功（仅模拟渠道 + PAYMENT_MOCK_ENABLED='true' 时可用，
   * 否则 404）。走完整验签回调链路，但「渠道扣款」由模拟账本产生，
   * 明确不代表真实资金；生产环境不得开启。
   */
  @Post('mock/simulate-success')
  simulateSuccess(
    @Req() req: AuthenticatedRequest,
    @Body() body: { orderId?: string },
  ) {
    if (!body?.orderId) throw new BadRequestException('缺少 orderId');
    return this.service.simulateMockPayment(req.user!.id, body.orderId);
  }
}
