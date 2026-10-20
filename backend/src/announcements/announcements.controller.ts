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
import { AnnouncementsService } from './announcements.service.js';
import { AdminGuard, ReviewGuard, StrictAdminGuard } from './admin.guard.js';
import type { ReviewAction } from './domain.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
  headers: Record<string, string | string[] | undefined>;
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  // ==================== 管理员：提交来源 ====================
  // 提交真实公告来源改写对用户展示的真实监测台账，属最高影响操作；
  // 仅限运营管理员（admin），审核员只负责审核与发布（职责分离）。

  @Post('sources')
  @UseGuards(StrictAdminGuard)
  async submitSource(
    @Body()
    body: {
      publisher: string;
      officialUrl: string;
      sourceType: string;
      content: string;
      mimeType: string;
      regionCode?: string;
      announcementId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user!.id;
    return this.service.submitSource(body, userId);
  }

  // ==================== 管理员：执行提取 ====================

  @Post('runs/:id/extract')
  @UseGuards(AdminGuard)
  async runExtraction(@Param('id') id: string) {
    return this.service.runExtraction(id);
  }

  // ==================== 管理员：任务列表与详情 ====================

  @Get('runs')
  @UseGuards(AdminGuard)
  async listRuns(@Query('status') status?: string, @Query('announcementId') announcementId?: string) {
    return this.service.listRuns({ status, announcementId });
  }

  @Get('runs/:id')
  @UseGuards(AdminGuard)
  async getRun(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Get('snapshots/:id/content')
  @UseGuards(AdminGuard)
  async getSnapshotContent(@Param('id') id: string) {
    return this.service.getSnapshotContent(id);
  }

  /** 审核详情第二层：快照的标准文档（解析产物）与来源变化 */
  @Get('snapshots/:id/parsed')
  @UseGuards(AdminGuard)
  async getSnapshotParsed(@Param('id') id: string) {
    return this.service.getSnapshotParsed(id);
  }

  // ==================== 审核员：提交审核 ====================

  @Post('runs/:id/review')
  @UseGuards(ReviewGuard)
  async submitReview(
    @Param('id') id: string,
    @Body()
    body: {
      action: ReviewAction;
      reason: string;
      editedFields?: Array<{ field: string; value: string; anchor?: object }>;
      fieldDecisions?: Array<{
        identity: string;
        field: string;
        action: 'adopt' | 'edit' | 'reject' | 'pending';
        afterValue?: string;
        reason: string;
      }>;
      baseUpdatedAt?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const reviewerName =
      (Array.isArray(req.headers['x-user-name'])
        ? req.headers['x-user-name'][0]
        : req.headers['x-user-name']) ?? '审核员';
    return this.service.submitReview(
      {
        runId: id,
        action: body.action,
        reason: body.reason,
        editedFields: body.editedFields as never,
        fieldDecisions: body.fieldDecisions as never,
        baseUpdatedAt: body.baseUpdatedAt,
      },
      { id: req.user!.id, name: reviewerName },
    );
  }

  // ==================== 审核员：发布 ====================

  @Post('runs/:id/publish')
  @UseGuards(ReviewGuard)
  async publish(
    @Param('id') id: string,
    @Body() body?: { dataset?: 'test' | 'demo' | 'real' },
  ) {
    return this.service.publish(id, body?.dataset);
  }

  // ==================== 管理员：重试失败任务 ====================

  @Post('runs/:id/retry')
  @UseGuards(AdminGuard)
  async retryRun(@Param('id') id: string) {
    return this.service.retryRun(id);
  }

  // ==================== 版本：公开只读 ====================

  @Get(':announcementId/versions')
  async listVersions(@Param('announcementId') announcementId: string) {
    return this.service.listVersions(announcementId);
  }

  // ==================== 审核员：撤回已发布版本（v7.2） ====================
  // 撤回保留历史（不删除行、不产生新版本），记录原因与操作人供审计。

  @Post(':announcementId/versions/:versionId/withdraw')
  @UseGuards(ReviewGuard)
  async withdraw(
    @Param('announcementId') announcementId: string,
    @Param('versionId') versionId: string,
    @Body() body: { reason: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.withdraw(
      announcementId,
      versionId,
      { reason: body.reason },
      { id: req.user!.id },
    );
  }

  // ==================== 管理员：投影状态（v7.2 审核详情用） ====================

  @Get(':announcementId/projection')
  @UseGuards(AdminGuard)
  async getProjectionStatus(@Param('announcementId') announcementId: string) {
    return this.service.getProjectionStatus(announcementId);
  }

  @Get(':announcementId/versions/diff')
  @UseGuards(AdminGuard)
  async getVersionDiff(
    @Param('announcementId') announcementId: string,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    return this.service.getVersionDiff(announcementId, Number(v1), Number(v2));
  }

  @Get(':announcementId/published')
  async getPublishedVersion(@Param('announcementId') announcementId: string) {
    return this.service.getPublishedVersion(announcementId);
  }
}
