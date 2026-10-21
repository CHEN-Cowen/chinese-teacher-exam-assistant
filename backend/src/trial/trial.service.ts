import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { getAuthMode } from '../auth/auth.service.js';
import { CATALOG_ANNOUNCEMENTS } from '../matching/catalog.js';
import { REAL_ANNOUNCEMENTS } from '../matching/real-catalog.js';
import { REAL_COVERAGE } from '../matching/coverage.js';
import {
  TRIAL_EVENT_TYPES,
  TRIAL_MODULES,
  computeSupplySnapshot,
  computeTrialDashboard,
  dedupKeyFor,
  sanitizeProps,
  type TrialDashboard,
  type TrialEventRecord,
} from './trial.domain.js';

/** 服务端事件保留与观察窗口：90 天 */
const RETENTION_DAYS = 90;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * unitId → 机会数据集（demo=演示台账 / real=真实监测台账）的静态索引。
 * 服务端解析，绝不信任客户端声明的 dataset。
 */
let datasetIndex: Map<string, 'demo' | 'real'> | null = null;
function datasetOfUnit(unitId: string | null): 'demo' | 'real' | null {
  if (!unitId) return null;
  if (!datasetIndex) {
    datasetIndex = new Map();
    const register = (
      announcements: readonly { dataset?: 'demo' | 'real' | 'test'; versions: readonly { units: readonly { id: string }[] }[] }[],
      dataset: 'demo' | 'real',
    ) => {
      for (const a of announcements) {
        for (const v of a.versions) {
          for (const u of v.units) {
            if (!datasetIndex!.has(u.id)) {
              // 静态目录（demo 台账 / real 台账）不含 test；test 值在此收窄丢弃
              const ds = a.dataset === 'test' ? dataset : (a.dataset ?? dataset);
              datasetIndex!.set(u.id, ds);
            }
          }
        }
      }
    };
    register(CATALOG_ANNOUNCEMENTS, 'demo');
    register(REAL_ANNOUNCEMENTS, 'real');
  }
  return datasetIndex.get(unitId) ?? null;
}

export interface IngestResult {
  accepted: boolean;
  deduped?: boolean;
}

/**
 * 受邀试用服务（v7.0 模块 7）。
 *
 * - POST /trial/events：摄取浏览器转发的事件。身份（userId/role/authMode）一律取
 *   服务端会话，绝不读客户端字段；props 白名单脱敏；once-per-user 去重交给库层
 *   唯一约束（重复点击 / 跨设备重报 → 幂等吞掉）；
 * - GET /trial/dashboard：管理员看板（AdminGuard），四层分群隔离；
 * - POST /trial/seed：管理员灌入演示种子（source=seed，只灌一次），用于演示看板。
 */
@Injectable()
export class TrialService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(userId: string, role: string, body: unknown): Promise<IngestResult> {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException('invalid_body');
    }
    const dto = body as Record<string, unknown>;

    const type = typeof dto.type === 'string' ? dto.type : '';
    if (!(TRIAL_EVENT_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException('unregistered_event_type');
    }
    const moduleName = typeof dto.module === 'string' ? dto.module : '';
    if (!(TRIAL_MODULES as readonly string[]).includes(moduleName)) {
      throw new BadRequestException('unregistered_module');
    }
    const unitId =
      typeof dto.unitId === 'string' && dto.unitId.length > 0 && dto.unitId.length <= 120
        ? dto.unitId
        : null;

    const sanitized = sanitizeProps(dto.props);
    if (!sanitized.ok) {
      // 资格原文 / 证件信息 / 超长文本在这里被拒绝，绝不落库
      throw new BadRequestException(sanitized.reason);
    }

    const now = Date.now();
    let occurredAt: Date;
    if (typeof dto.at === 'string') {
      const parsed = new Date(dto.at);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('bad_occurred_at');
      if (parsed.getTime() > now + FUTURE_SKEW_MS) {
        throw new BadRequestException('occurred_at_in_future');
      }
      if (parsed.getTime() < now - RETENTION_DAYS * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('occurred_at_too_old');
      }
      occurredAt = parsed;
    } else {
      occurredAt = new Date(now);
    }

    const dedupKey = dedupKeyFor(type, unitId, sanitized.props);

    try {
      await this.prisma.trialEvent.create({
        data: {
          userId,
          type,
          module: moduleName,
          unitId,
          dataset: datasetOfUnit(unitId),
          props: sanitized.props ?? Prisma.JsonNull,
          source: 'live',
          authMode: getAuthMode(),
          userRole: role,
          dedupKey,
          occurredAt,
        },
      });
    } catch (error) {
      // once-per-user 唯一冲突：重复点击 / 换设备重报，按幂等成功处理
      if ((error as { code?: string }).code === 'P2002') {
        return { accepted: true, deduped: true };
      }
      throw error;
    }
    return { accepted: true };
  }

  async dashboard(): Promise<TrialDashboard> {
    const since = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.trialEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: 'asc' },
    });
    const records: TrialEventRecord[] = rows.map((row) => ({
      userId: row.userId,
      userRole: row.userRole,
      type: row.type,
      unitId: row.unitId,
      dataset: row.dataset,
      source: row.source,
      authMode: row.authMode,
      props: (row.props ?? null) as Record<string, unknown> | null,
      occurredAt: row.occurredAt,
    }));
    return {
      ...computeTrialDashboard(records, new Date()),
      supply: computeSupplySnapshot(REAL_ANNOUNCEMENTS, REAL_COVERAGE, new Date()),
    };
  }

  /**
   * 灌入演示种子（幂等：已有种子则跳过）。种子事件 source='seed'，
   * 在看板中与 live 数据隔离展示，绝不混入受邀真实指标。
   */
  async seedDemo(): Promise<{ seeded: boolean }> {
    const existing = await this.prisma.trialEvent.findFirst({
      where: { userId: { startsWith: 'trial-seed-' } },
      select: { id: true },
    });
    if (existing) return { seeded: false };

    const realUnit = REAL_ANNOUNCEMENTS[0]?.versions[0]?.units[0]?.id ?? null;
    const demoUnit = CATALOG_ANNOUNCEMENTS[0]?.versions[0]?.units[0]?.id ?? null;
    const dayAgo = (days: number): Date => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      d.setHours(9, 0, 0, 0);
      return d;
    };

    type Row = Prisma.TrialEventCreateManyInput[];
    const rows: Row = [];
    const push = (
      userId: string,
      days: number,
      type: string,
      module: string,
      extra: Partial<Prisma.TrialEventCreateManyInput> = {},
    ) => {
      rows.push({
        userId,
        type,
        module,
        source: 'seed',
        authMode: 'demo',
        userRole: 'user',
        occurredAt: dayAgo(days),
        ...extra,
      });
    };

    // s1：完整旅程（10 天前获得真实机会，7 日内关注并推进 → 计入北极星分子）
    for (let step = 1; step <= 5; step += 1) {
      push('trial-seed-u1', 10, 'profile_step_completed', 'profile', {
        unitId: realUnit,
        dataset: realUnit ? 'real' : null,
        props: { step },
        dedupKey: `once:profile_step_completed:${step}`,
      });
    }
    push('trial-seed-u1', 10, 'profile_completed', 'profile', {
      props: { stepCount: 5 },
      dedupKey: 'once:profile_completed',
    });
    push('trial-seed-u1', 10, 'opportunity_revealed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 2 },
      dedupKey: 'once:opportunity_revealed',
    });
    push('trial-seed-u1', 10, 'match_basis_viewed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { fieldCount: 6 },
      dedupKey: `once:match_basis_viewed:${realUnit ?? ''}`,
    });
    push('trial-seed-u1', 9, 'opportunity_followed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:opportunity_followed:${realUnit ?? ''}`,
    });
    push('trial-seed-u1', 9, 'follow_status_changed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { from: 'considering', to: 'preparing' },
    });
    push('trial-seed-u1', 9, 'primary_target_set', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
    });
    push('trial-seed-u1', 8, 'material_status_changed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { to: 'done' },
    });
    push('trial-seed-u1', 8, 'register_entry_opened', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:register_entry_opened:${realUnit ?? ''}`,
    });
    push('trial-seed-u1', 8, 'follow_status_changed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { from: 'preparing', to: 'registered' },
    });

    // s2：5 天前获得机会（未满 7 日观察期 → 只进「观察中」分群）
    push('trial-seed-u2', 5, 'opportunity_revealed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 1 },
      dedupKey: 'once:opportunity_revealed',
    });
    push('trial-seed-u2', 4, 'opportunity_followed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:opportunity_followed:${realUnit ?? ''}`,
    });
    push('trial-seed-u2', 4, 'follow_status_changed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { from: 'considering', to: 'preparing' },
    });

    // s3：关注但无推进动作（满观察期 → 分母，不进分子）
    push('trial-seed-u3', 12, 'opportunity_revealed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 1 },
      dedupKey: 'once:opportunity_revealed',
    });
    push('trial-seed-u3', 11, 'opportunity_followed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:opportunity_followed:${realUnit ?? ''}`,
    });

    // s4：仅获得机会（分母）
    push('trial-seed-u4', 15, 'opportunity_revealed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 3 },
      dedupKey: 'once:opportunity_revealed',
    });

    // s5：员工账号（进「受邀员工账号」分群，不混入真实用户）
    push('trial-seed-u5', 9, 'opportunity_revealed', 'opportunity', {
      userRole: 'exam_reviewer',
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 1 },
      dedupKey: 'once:opportunity_revealed',
    });
    push('trial-seed-u5', 8, 'opportunity_followed', 'opportunity', {
      userRole: 'exam_reviewer',
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:opportunity_followed:${realUnit ?? ''}`,
    });

    // s6：重复点击关注两次（库层去重后只算一次）+ 取消关注
    push('trial-seed-u6', 8, 'opportunity_revealed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      props: { validCount: 1 },
      dedupKey: 'once:opportunity_revealed',
    });
    push('trial-seed-u6', 7, 'opportunity_followed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
      dedupKey: `once:opportunity_followed:${realUnit ?? ''}`,
    });
    push('trial-seed-u6', 6, 'opportunity_unfollowed', 'opportunity', {
      unitId: realUnit,
      dataset: realUnit ? 'real' : null,
    });

    // s7：只看过演示台账机会（进 datasetSplit.demo，不进北极星分母）
    push('trial-seed-u7', 8, 'opportunity_revealed', 'opportunity', {
      unitId: demoUnit,
      dataset: demoUnit ? 'demo' : null,
      props: { validCount: 1 },
      dedupKey: 'once:opportunity_revealed',
    });

    await this.prisma.trialEvent.createMany({ data: rows, skipDuplicates: true });
    return { seeded: true };
  }
}
