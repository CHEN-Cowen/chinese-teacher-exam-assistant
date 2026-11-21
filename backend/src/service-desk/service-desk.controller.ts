/**
 * 人工处理工作台 API（2026-11-08）。
 * 后台路由统一由 AdminGuard 做服务端鉴权；配置类操作只允许 admin。
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, StrictAdminGuard } from '../auth/admin.guard.js';
import { ServiceDeskService } from './service-desk.service.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

function actorOf(req: AuthenticatedRequest): { id: string; role: string } {
  return { id: req.user?.id ?? '', role: req.user?.role ?? 'user' };
}

@Controller('admin/service-desk')
@UseGuards(AdminGuard)
export class ServiceDeskController {
  constructor(private readonly service: ServiceDeskService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Put('config')
  @UseGuards(StrictAdminGuard)
  updateConfig(
    @Req() req: AuthenticatedRequest,
    @Body() body: { dutyOwnerId?: unknown; backupOwnerId?: unknown; reason?: unknown },
  ) {
    return this.service.updateConfig(actorOf(req), body);
  }

  @Get('eligible-owners')
  listEligibleOwners() {
    return this.service.listEligibleOwners();
  }

  @Get('policies')
  getPolicies() {
    return this.service.getPolicies();
  }

  @Put('policies')
  @UseGuards(StrictAdminGuard)
  updatePolicies(
    @Req() req: AuthenticatedRequest,
    @Body() body: { policies?: unknown; reason?: unknown },
  ) {
    return this.service.updatePolicies(actorOf(req), body);
  }

  @Get('published-results')
  searchPublishedResults(@Query('q') q?: string) {
    return this.service.searchPublishedResults(q ?? '');
  }

  @Get('queue')
  listQueue(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string>) {
    return this.service.listQueue(actorOf(req).id, query);
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.service.getTaskDetail(id);
  }

  @Post('tasks/:id/claim')
  claim(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { expectedVersion?: unknown },
  ) {
    return this.service.claim(actorOf(req), id, body);
  }

  @Post('tasks/:id/transfer')
  transfer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { toUserId?: unknown; reason?: unknown; expectedVersion?: unknown },
  ) {
    return this.service.transfer(actorOf(req), id, body);
  }

  @Post('tasks/:id/priority')
  setPriority(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { priority?: unknown; reason?: unknown; expectedVersion?: unknown },
  ) {
    return this.service.setPriority(actorOf(req), id, body);
  }

  @Post('tasks/:id/notes')
  addNote(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      message?: unknown;
      visibility?: unknown;
      waitingReason?: unknown;
      nextFollowUpAt?: unknown;
    },
  ) {
    return this.service.addNote(actorOf(req), id, body);
  }

  @Post('tasks/:id/request-supplement')
  requestSupplement(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { question?: unknown },
  ) {
    return this.service.requestSupplement(actorOf(req), id, body);
  }

  @Post('tasks/:id/start-review')
  startReview(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.startReview(actorOf(req), id);
  }

  @Post('tasks/:id/resolve-correction')
  resolveCorrection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { status?: unknown; reviewNote?: unknown; resolvedVersionId?: unknown },
  ) {
    return this.service.resolveCorrection(actorOf(req), id, body);
  }

  @Post('tasks/:id/resolve-submission')
  resolveSubmission(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      status?: unknown;
      reviewNote?: unknown;
      expectedAnnouncementId?: unknown;
      expectedVersionId?: unknown;
      resolutionBasis?: unknown;
    },
  ) {
    return this.service.resolveAnnouncementSubmission(actorOf(req), id, body);
  }

  @Post('tasks/:id/complete-derived')
  completeDerived(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      outcome?: unknown;
      note?: unknown;
      extractionRunId?: unknown;
      missingCheckNote?: unknown;
    },
  ) {
    return this.service.completeDerivedTask(actorOf(req), id, body);
  }

  @Get('metrics')
  metrics() {
    return this.service.metrics();
  }

  /** 手动触发一次扫描（运维/验收用；Worker 仍按 5 分钟自动扫描） */
  @Post('scan')
  @UseGuards(StrictAdminGuard)
  scan() {
    return this.service.runSweep({ trigger: 'admin_manual' });
  }
}
