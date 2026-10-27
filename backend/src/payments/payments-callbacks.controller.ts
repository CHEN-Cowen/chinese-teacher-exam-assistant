/**
 * 支付渠道回调入口（M12）。
 *
 * 专用回调路径使用「渠道认证」而非用户会话：全局 SessionAuthGuard 放行
 * /payments/callbacks/:channel 精确路径，本控制器第一道动作即渠道验签
 * （验签失败 401，不落库、不放行）；这不是整体放开匿名访问——除该精确
 * 路径外，支付相关接口全部要求登录或管理员身份。
 *
 * 应答码（模拟渠道协议；真实微信接入时按官方应答规范适配）：
 * - 200 {code:'SUCCESS'}：已处理或重复通知（幂等）；
 * - 200 {code:'REJECTED', reason}：业务校验失败（商户号/订单/金额/币种不符），
 *   永久拒绝，渠道无需重试；
 * - 401：验签失败或时间窗过期；
 * - 404：未知渠道；
 * - 500：内部处理失败（权益发放异常等），渠道应重推，重推各步骤幂等。
 */
import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';

@Controller('payments/callbacks')
export class PaymentsCallbacksController {
  constructor(private readonly service: PaymentsService) {}

  @Post(':channel')
  async handle(
    @Param('channel') channel: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ) {
    return this.service.processCallback(channel, headers, body);
  }
}
