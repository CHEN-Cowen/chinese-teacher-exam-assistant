import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service.js';
import { UserGuard } from './user.guard.js';
import { AdminGuard, ReviewGuard } from '../auth/admin.guard.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
}

/**
 * 机会发现与可解释资格匹配 API（模块 5 / v7.1 M8）。
 * 匹配与详情对未登录用户开放（访客预筛价值优先）；其余接口需登录。
 * 身份由 resolveAuthenticatedUser 统一决定：
 * - invited 模式：服务端会话 cookie；
 * - demo 模式：x-user-id / x-user-role 请求头。
 */
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  /** 首页公开读取覆盖摘要，不需要画像或登录。 */
  @Get('coverage')
  getCoverage() {
    return this.service.coverage();
  }

  /**
   * 往年参考列表（D06 / PRD 11.7 U06：公开只读）。
   * 已截止/已撤回的往年公告，不进入当前可报名计数，无任何报名动作。
   */
  @Get('history')
  listHistory(
    @Query('year') year?: string,
    @Query('regionCode') regionCode?: string,
    @Query('stage') stage?: string,
    @Query('nature') nature?: string,
    @Query('keyword') keyword?: string,
    @Query('educationLevel') educationLevel?: string,
    @Query('major') major?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listHistory({
      year,
      regionCode,
      stage,
      nature,
      keyword,
      educationLevel,
      major,
      page,
      pageSize,
    });
  }

  /**
   * 往年参考详情（D06：公开；画像可选）。
   * 未登录用户在请求体携带访客画像用于对照；已登录用户画像由服务端读取；
   * 都没有时对照区为 null，历史事实仍可读。
   */
  @Post('history/:unitId/detail')
  historyDetail(
    @Param('unitId') unitId: string,
    @Body() body: { profile?: unknown } | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.historyDetail(body?.profile, req.user?.id, unitId);
  }

  /** 当前用户的新机会订阅（v7.1 M6；未开启过返回 null） */
  @Get('subscription')
  @UseGuards(UserGuard)
  getSubscription(@Req() req: AuthenticatedRequest) {
    return this.service.getSubscription(req.user!.id);
  }

  /** 创建/修改订阅（每用户一条；enabled=false 关闭后停止新提醒，历史通知保留） */
  @Put('subscription')
  @UseGuards(UserGuard)
  upsertSubscription(
    @Body()
    body: {
      regions?: unknown;
      subject?: unknown;
      naturePreference?: unknown;
      enabled?: unknown;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.upsertSubscription(req.user!.id, body);
  }

  /** 订阅同步（幂等）：已人工核对的匹配新公告产生一次站内提醒 */
  @Post('subscription/sync')
  @UseGuards(UserGuard)
  syncSubscription(@Req() req: AuthenticatedRequest) {
    return this.service.syncSubscription(req.user!.id);
  }

  /**
   * 机会列表（v7.1 M8：访客可访问）。
   * 未登录用户在请求体携带访客画像；已登录用户画像由服务端读取。
   * 登录用户的关注状态会附加到结果中（访客无关注记录）。
   */
  @Post('match')
  match(
    @Body() body: { profile?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.match(body.profile, req.user?.id);
  }

  /**
   * 机会详情（v7.1 M8：访客可访问）。
   * 未登录用户在请求体携带访客画像；已登录用户画像由服务端读取。
   * 登录用户的关注状态会附加到结果中（访客无关注记录）。
   */
  @Post('units/:unitId/detail')
  detail(
    @Param('unitId') unitId: string,
    @Body() body: { profile?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.unitDetail(body.profile, req.user?.id, unitId);
  }

  /** 当前用户的全部关注记录（含主要目标与版本过时标记） */
  @Get('follows')
  @UseGuards(UserGuard)
  listFollows(@Req() req: AuthenticatedRequest) {
    return this.service.listFollows(req.user!.id);
  }

  /** 登录后合并访客在本机暂存的关注记录（服务端已有则跳过） */
  @Post('follows/merge')
  @UseGuards(UserGuard)
  mergeGuestFollows(
    @Body()
    body: {
      items?: Array<{
        unitId?: unknown;
        status?: unknown;
        materialStatuses?: unknown;
        consultationNotes?: unknown;
      }>;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.mergeGuestFollows(req.user!.id, body.items ?? []);
  }

  /** 备考目标列表（模块 7）：活跃关注聚合公告版本，供 /study 页与主要目标选择 */
  @Get('goals')
  @UseGuards(UserGuard)
  listGoals(@Req() req: AuthenticatedRequest) {
    return this.service.listGoals(req.user!.id);
  }

  /** 当前用户的单位关注列表（D07 / PRD 11.8 U07） */
  @Get('organization-follows')
  @UseGuards(UserGuard)
  listOrganizationFollows(@Req() req: AuthenticatedRequest) {
    return this.service.listOrganizationFollows(req.user!.id);
  }

  /** 关注单位：身份键 = 规范化发布主体名 + 地区码（仅精确匹配；重复关注幂等） */
  @Post('organization-follows')
  @UseGuards(UserGuard)
  followOrganization(
    @Body() body: { publisherName?: unknown; regionCode?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.followOrganization(req.user!.id, body ?? {});
  }

  /** 取消单位关注（按身份键；幂等） */
  @Delete('organization-follows/:identityKey')
  @UseGuards(UserGuard)
  unfollowOrganization(
    @Param('identityKey') identityKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.unfollowOrganization(req.user!.id, identityKey);
  }

  /** 关注（初始恒为"考虑中"，收藏不自动等于准备报名） */
  @Post('units/:unitId/follow')
  @UseGuards(UserGuard)
  follow(
    @Param('unitId') unitId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.follow(req.user!.id, unitId);
  }

  /** 状态流转：preparing / registered / abandoned / closed / considering。
   *  带 version 乐观锁：与服务端不一致时返回 409 + 当前状态。 */
  @Patch('units/:unitId/follow')
  @UseGuards(UserGuard)
  transition(
    @Param('unitId') unitId: string,
    @Body()
    body: { status?: unknown; note?: string; abandonReason?: string; version?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.transition(
      req.user!.id,
      unitId,
      body.status,
      typeof body.note === 'string' ? body.note : undefined,
      typeof body.abandonReason === 'string'
        ? body.abandonReason
        : undefined,
      typeof body.version === 'number' ? body.version : undefined,
    );
  }

  /** 设置某报名材料项的完成状态（带 version 乐观锁） */
  @Patch('units/:unitId/materials')
  @UseGuards(UserGuard)
  setMaterialStatus(
    @Param('unitId') unitId: string,
    @Body()
    body: { itemId?: unknown; status?: unknown; version?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.setMaterialStatus(
      req.user!.id,
      unitId,
      body.itemId,
      body.status,
      typeof body.version === 'number' ? body.version : undefined,
    );
  }

  /** 记录用户自行填写的官方咨询结论（不参与匹配判断，带 version 乐观锁） */
  @Patch('units/:unitId/consultation')
  @UseGuards(UserGuard)
  saveConsultationNote(
    @Param('unitId') unitId: string,
    @Body()
    body: { dimensionKey?: unknown; note?: unknown; version?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.saveConsultationNote(
      req.user!.id,
      unitId,
      body.dimensionKey,
      body.note,
      typeof body.version === 'number' ? body.version : undefined,
    );
  }

  /** 取消关注（仅删除该单元记录） */
  @Delete('units/:unitId/follow')
  @UseGuards(UserGuard)
  unfollow(
    @Param('unitId') unitId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.unfollow(req.user!.id, unitId);
  }

  /** 设置主要/备选备考目标（主要目标全局唯一） */
  @Put('units/:unitId/role')
  @UseGuards(UserGuard)
  setRole(
    @Param('unitId') unitId: string,
    @Body() body: { role?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.setRole(req.user!.id, unitId, body.role);
  }

  /** 开启/关闭单个机会的站内提醒（不影响日程展示，只控制通知生成） */
  @Patch('units/:unitId/reminders')
  @UseGuards(UserGuard)
  setRemindersMuted(
    @Param('unitId') unitId: string,
    @Body() body: { muted?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const muted = typeof body.muted === 'boolean' ? body.muted : !!body.muted;
    return this.service.setRemindersMuted(req.user!.id, unitId, muted);
  }

  /** 详情第三层：提交证据/条件/版本纠错留痕 */
  @Post('units/:unitId/corrections')
  @UseGuards(UserGuard)
  submitCorrection(
    @Param('unitId') unitId: string,
    @Body()
    body: { fieldPath?: unknown; content?: unknown; contact?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.submitCorrection(req.user!.id, unitId, body);
  }

  /** 当前用户提交过的纠错与员工处理状态（我的页） */
  @Get('corrections/mine')
  @UseGuards(UserGuard)
  listMyCorrections(@Req() req: AuthenticatedRequest) {
    return this.service.listMyCorrections(req.user!.id);
  }

  /** 员工纠错队列：STAFF_ROLES 可读（resource_reviewer 只读浏览） */
  @Get('admin/corrections')
  @UseGuards(AdminGuard)
  listStaffCorrections(
    @Query('status') status: string | undefined,
    @Req() _req: AuthenticatedRequest,
  ) {
    const normalized =
      typeof status === 'string' && status.trim() ? status.trim() : null;
    return this.service.listCorrectionsForStaff(normalized);
  }

  /** 员工处理纠错：仅 exam_reviewer/admin；终态通知提交人 */
  @Patch('admin/corrections/:id')
  @UseGuards(ReviewGuard)
  reviewCorrection(
    @Param('id') id: string,
    @Body()
    body: { status?: unknown; reviewNote?: unknown; resolvedVersionId?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.reviewCorrection(
      { id: req.user!.id, role: req.user!.role },
      id,
      body,
    );
  }

  // ==================== 公告补录（D08 / PRD 11.9 U08） ====================

  /** 用户补录未收录官方公告：只进运营待办，不直接发布 */
  @Post('announcement-submissions')
  @UseGuards(UserGuard)
  submitAnnouncementSubmission(
    @Body()
    body: {
      officialUrl?: unknown;
      publisherName?: unknown;
      regionCode?: unknown;
      note?: unknown;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.submitAnnouncementSubmission(req.user!.id, body);
  }

  /** 当前用户提交过的补录与处理状态（我的页） */
  @Get('announcement-submissions/mine')
  @UseGuards(UserGuard)
  listMyAnnouncementSubmissions(@Req() req: AuthenticatedRequest) {
    return this.service.listMyAnnouncementSubmissions(req.user!.id);
  }

  /** 员工补录队列：STAFF_ROLES 可读 */
  @Get('admin/announcement-submissions')
  @UseGuards(AdminGuard)
  listStaffAnnouncementSubmissions(
    @Query('status') status: string | undefined,
    @Req() _req: AuthenticatedRequest,
  ) {
    const normalized =
      typeof status === 'string' && status.trim() ? status.trim() : null;
    return this.service.listAnnouncementSubmissionsForStaff(normalized);
  }

  /** 员工处理补录：仅 exam_reviewer/admin；状态推进通知提交人 */
  @Patch('admin/announcement-submissions/:id')
  @UseGuards(ReviewGuard)
  reviewAnnouncementSubmission(
    @Param('id') id: string,
    @Body() body: { status?: unknown; reviewNote?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.reviewAnnouncementSubmission(
      { id: req.user!.id, role: req.user!.role },
      id,
      body,
    );
  }
}
