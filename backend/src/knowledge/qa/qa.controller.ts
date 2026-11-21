/**
 * W3：问答与检索接口。
 *
 * - `/knowledge/qa` 需要登录会话：按用户与 IP 做当日预算，响应不含密钥；
 * - 反馈只允许当前登录用户对回答打标；
 * - 检索调试接口仅管理员可用，返回分数明细用于验收取证。
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
import { AdminGuard } from '../../auth/admin.guard.js';
import {
  resolveAuthenticatedUser,
  type AuthenticatedRequest,
} from '../../auth/identity.js';
import type { KnowledgeScope } from '../knowledge-search.service.js';
import { KnowledgeSearchService } from '../knowledge-search.service.js';
import { normalizeRegionCode } from '../policy/policy-domain.js';
import { PolicyCoverageService } from '../policy/policy-coverage.service.js';
import { QaError, QaService, toQaError } from './qa.service.js';

/** 身份与 AdminGuard 一致：invited 取会话，demo 取 x-user-* 头，绝不混用。 */
function currentUserId(req: AuthenticatedRequest): string | undefined {
  return resolveAuthenticatedUser(req)?.id;
}

interface AskBody {
  question?: string;
  announcementId?: string;
  unitId?: string;
  regionCode?: string;
  documentTypes?: string[];
}

interface PolicyAskBody {
  question?: string;
  regionCode?: string;
  year?: number | string;
  applicableSubjects?: string[];
  applicableAudience?: string;
}

@Controller('knowledge')
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly search: KnowledgeSearchService,
    private readonly coverage: PolicyCoverageService,
  ) {}

  @Post('qa')
  async ask(@Body() body: AskBody, @Req() req: AuthenticatedRequest) {
    const userId = currentUserId(req);
    if (!userId) throw new QaError('unauthorized', '请先登录后再提问', 401);
    try {
      return await this.qa.ask({
        question: body?.question ?? '',
        scope: scopeFrom(body),
        userId,
        ip: req.ip ?? null,
      });
    } catch (error) {
      throw toQaError(error);
    }
  }

  @Post('qa/:id/feedback')
  async feedback(
    @Param('id') id: string,
    @Body() body: { type?: string; comment?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = currentUserId(req);
    if (!userId) throw new QaError('unauthorized', '请先登录', 401);
    const type = body?.type;
    if (type !== 'helpful' && type !== 'not_helpful' && type !== 'incorrect') {
      throw new QaError('invalid_feedback', '反馈类型不合法', 400);
    }
    return this.qa.feedback({
      answerId: id,
      userId,
      type,
      comment: body?.comment,
    });
  }

  @Get('qa/history')
  async history(
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = currentUserId(req);
    if (!userId) throw new QaError('unauthorized', '请先登录', 401);
    return this.qa.history(userId, limit ? Number(limit) : 10);
  }

  /** 管理员检索调试：只返回已发布版本片段，便于核对引用定位 */
  @Post('search')
  @UseGuards(AdminGuard)
  async debugSearch(@Body() body: AskBody) {
    const question = (body?.question ?? '').trim();
    if (!question) throw new QaError('question_empty', '请输入检索问题', 400);
    return this.search.debugSearch(question, scopeFrom(body), 10);
  }

  /**
   * W5：范围明确的政策问答。
   * 必须登录（避免匿名消耗模型预算）；地区/年份必填。
   */
  @Post('questions')
  async askPolicy(@Body() body: PolicyAskBody, @Req() req: AuthenticatedRequest) {
    const userId = currentUserId(req);
    if (!userId) throw new QaError('unauthorized', '请先登录后再提问', 401);
    const year = typeof body?.year === 'string' ? Number(body.year) : body?.year;
    try {
      return await this.qa.askPolicy({
        question: body?.question ?? '',
        regionCode: body?.regionCode ?? '',
        year: year as number,
        applicableSubjects: Array.isArray(body?.applicableSubjects)
          ? body.applicableSubjects.filter((item) => typeof item === 'string')
          : undefined,
        applicableAudience:
          typeof body?.applicableAudience === 'string' ? body.applicableAudience : undefined,
        userId,
        ip: req.ip ?? null,
      });
    } catch (error) {
      throw toQaError(error);
    }
  }

  /**
   * W5：公开覆盖查询。只返回已发布材料的聚合覆盖，不含用户数据。
   * 与“问答失败”区分：查询失败返回 503，不伪装成无覆盖。
   */
  @Get('policy-coverage')
  async policyCoverage(
    @Query('regionCode') regionCodeRaw: string | undefined,
    @Query('year') yearRaw: string | undefined,
    @Query('subject') subject: string | undefined,
    @Query('subjects') subjectsRaw: string | undefined,
  ) {
    const regionCode = normalizeRegionCode(regionCodeRaw);
    if (!regionCode) {
      throw new QaError('region_invalid', '请选择有效的地区（全国或 6 位行政区划代码）', 400);
    }
    const year = yearRaw ? Number(yearRaw) : currentYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new QaError('year_invalid', '请选择有效的适用年份（2000—2100）', 400);
    }
    const subjects = [
      ...(subject ? [subject] : []),
      ...(subjectsRaw
        ? subjectsRaw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : []),
    ];
    try {
      return await this.coverage.coverage({ regionCode, year, subjects });
    } catch {
      throw new QaError(
        'coverage_unavailable',
        '覆盖查询暂不可用，请稍后再试',
        503,
      );
    }
  }
}

function currentYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date()),
  );
}

function scopeFrom(body: AskBody | undefined): KnowledgeScope {
  if (!body) return {};
  return {
    ...(body.announcementId ? { announcementId: body.announcementId } : {}),
    ...(body.unitId ? { unitId: body.unitId } : {}),
    ...(body.regionCode ? { regionCode: body.regionCode } : {}),
    ...(Array.isArray(body.documentTypes) && body.documentTypes.length > 0
      ? { documentTypes: body.documentTypes.filter((item) => typeof item === 'string') }
      : {}),
  };
}
