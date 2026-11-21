import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { MembershipService } from './membership.service.js';
import { UserGuard } from '../opportunities/user.guard.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

/**
 * 会员权益 API（M11）。
 * - GET /membership/plans：公开套餐与售卖开关（价格页透明展示，无需登录）；
 * - GET /membership/mine：当前用户会员状态（需登录）；
 *   套餐价格与透明口径由价格页静态展示 + 服务端 plans 配置双端对齐。
 * - 不把 User.role 当会员状态；权益发放经 issueGrant（M12 支付回调幂等接入）。
 */
@Controller('membership')
export class MembershipController {
  constructor(private readonly service: MembershipService) {}

  /** 公开：套餐价格、可购性与售卖开关（价格页） */
  @Get('plans')
  plans() {
    return this.service.getPlans();
  }

  @Get('mine')
  @UseGuards(UserGuard)
  mine(@Req() req: AuthenticatedRequest) {
    return this.service.getMembershipView(req.user!.id);
  }
}
