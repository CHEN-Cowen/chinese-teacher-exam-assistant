/**
 * W2：知识材料管理接口（仅后台角色）。
 *
 * - 上传/提交只生成待处理草稿，不自动公开；
 * - 审核、发布、撤回沿用既有角色分工（ReviewGuard / StrictAdminGuard）；
 * - 索引状态与失败原因可查，支持人工重建；
 * - 用户端检索接口在 W3 提供，本控制器不向普通用户暴露原文。
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReviewGuard, StrictAdminGuard, AdminGuard } from '../auth/admin.guard.js';
import type { CreateKnowledgeDocumentInput } from './knowledge.types.js';
import { KnowledgeService } from './knowledge.service.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  // ==================== 材料入库 ====================

  @Post('documents')
  @UseGuards(StrictAdminGuard)
  async createDocument(
    @Body() body: CreateKnowledgeDocumentInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createDocument(body, req.user?.id ?? null);
  }

  @Get('documents')
  @UseGuards(AdminGuard)
  async listDocuments(
    @Query('status') status?: string,
    @Query('documentType') documentType?: string,
    @Query('regionCode') regionCode?: string,
    @Query('announcementId') announcementId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listDocuments({
      status,
      documentType,
      regionCode,
      announcementId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('documents/:id')
  @UseGuards(AdminGuard)
  async getDocument(@Param('id') id: string) {
    return this.service.getDocument(id);
  }

  // ==================== 审核 / 发布 / 撤回 ====================

  @Post('versions/:id/submit-review')
  @UseGuards(AdminGuard)
  async submitReview(@Param('id') id: string) {
    return this.service.submitReview(id);
  }

  @Post('versions/:id/approve')
  @UseGuards(ReviewGuard)
  async approve(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.approve(id, req.user?.id ?? null, body?.note);
  }

  @Post('versions/:id/reject')
  @UseGuards(ReviewGuard)
  async reject(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.rejectToDraft(id, req.user?.id ?? null, body?.note);
  }

  @Post('versions/:id/publish')
  @UseGuards(ReviewGuard)
  async publish(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.publish(id, req.user?.id ?? null);
  }

  @Post('documents/:id/withdraw')
  @UseGuards(ReviewGuard)
  async withdraw(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.withdraw(id, req.user?.id ?? null, body?.reason);
  }

  // ==================== 索引任务 ====================

  @Post('versions/:id/index')
  @UseGuards(AdminGuard)
  async rebuildIndex(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.rebuildIndex(id, req.user?.id ?? null);
  }

  @Get('index-jobs')
  @UseGuards(AdminGuard)
  async listIndexJobs(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listIndexJobs({
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 模型/向量/数量状态（不含密钥），供后台确认是否真实接通 */
  @Get('status')
  @UseGuards(AdminGuard)
  async status() {
    return this.service.status();
  }
}
