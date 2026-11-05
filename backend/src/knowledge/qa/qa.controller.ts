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
import type { KnowledgeScope } from '../knowledge-search.service.js';
import { KnowledgeSearchService } from '../knowledge-search.service.js';
import { QaError, QaService, toQaError } from './qa.service.js';

interface AuthenticatedRequest {
  user?: { id: string; role: string };
  ip?: string;
}

interface AskBody {
  question?: string;
  announcementId?: string;
  unitId?: string;
  regionCode?: string;
  documentTypes?: string[];
}

@Controller('knowledge')
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly search: KnowledgeSearchService,
  ) {}

  @Post('qa')
  async ask(@Body() body: AskBody, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
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
    const userId = req.user?.id;
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
    const userId = req.user?.id;
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
