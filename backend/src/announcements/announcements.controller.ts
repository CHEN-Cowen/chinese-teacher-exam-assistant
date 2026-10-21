import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AnnouncementsService } from './announcements.service.js';
import { ExportService } from './export.service.js';
import { AdminGuard, ReviewGuard, StrictAdminGuard } from './admin.guard.js';
import type { ReviewAction } from './domain.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
  headers: Record<string, string | string[] | undefined>;
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly service: AnnouncementsService,
    private readonly exportService: ExportService,
  ) {}

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
      /** M1：岗位附件（base64 编码字节），与正文组成材料包 */
      attachments?: Array<{ name: string; mimeType?: string; base64: string }>;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user!.id;
    return this.service.submitSource(
      {
        publisher: body.publisher,
        officialUrl: body.officialUrl,
        sourceType: body.sourceType,
        content: body.content,
        mimeType: body.mimeType,
        regionCode: body.regionCode,
        announcementId: body.announcementId,
        attachments: (body.attachments ?? []).map((att) => ({
          name: att.name,
          mimeType: att.mimeType,
          bytes: Buffer.from(att.base64, 'base64'),
        })),
      },
      userId,
    );
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

  // ==================== 管理员：M2 期望清单（固定分母） ====================
  // 冻结清单即确立固定分母；岗位集合由人工独立清点/补入，不从本轮候选推断。
  // 修改清单新增版本（version 递增，保留历史）。

  @Get('runs/:id/checklist')
  @UseGuards(AdminGuard)
  async getChecklist(@Param('id') id: string) {
    return this.service.getChecklist(id);
  }

  @Post('runs/:id/checklist')
  @UseGuards(StrictAdminGuard)
  async freezeChecklist(
    @Param('id') id: string,
    @Body()
    body: {
      source?: 'independent' | 'retrospective';
      jobs: Array<{ key: string; jobCode?: string; sheet?: string; row?: number }>;
      applicabilityOverrides?: Array<{
        field: string;
        jobKey?: string;
        applicability: 'applicable' | 'not_applicable';
        basis: string;
      }>;
      note?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.freezeChecklist(id, body, { id: req.user!.id });
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

  // ==================== 管理员：审核导出与实测指标（WB6，只读） ====================
  // 复用管理员权限（STAFF_ROLES）；导出基于服务端已保存记录，不从 UI 状态拼装。
  // 下载响应显式设置 Content-Type / Content-Disposition / Cache-Control: no-store。

  @Get('runs/:id/export/json')
  @UseGuards(AdminGuard)
  async exportRunJson(@Param('id') id: string, @Res() res: Response) {
    const { body, filename } = await this.exportService.exportJson(id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @Get('runs/:id/export/csv')
  @UseGuards(AdminGuard)
  async exportRunCsv(@Param('id') id: string, @Res() res: Response) {
    const { body, filename } = await this.exportService.exportCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @Get('runs/:id/export/metrics')
  @UseGuards(AdminGuard)
  async getExportMetrics(@Param('id') id: string) {
    return this.exportService.getMetrics(id);
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
