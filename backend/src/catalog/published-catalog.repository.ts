/**
 * v7.2 工作包 3：已发布公告目录仓库（数据库唯一事实源）。
 *
 * 职责：从 `PublishedAnnouncementVersion` 读取已发布版本，投影为匹配引擎消费的
 * `RecruitmentAnnouncement` 领域对象；不新建第二套目录，不反向依赖 run/snapshot/source。
 *
 * 状态口径（R-WP3-01/02）：
 * - `published`：唯一事实源，一个公告的“当前版本”取 versionNumber 最高且投影成功者；
 * - `superseded`：仅用于版本链展示（详情页 previousVersions）与投影失败回退；
 * - `withdrawn`：仅用于标记 lifecycle='withdrawn'（撤回保留审计、不进入正常机会）；
 * - 投影失败：跳过该行并记录告警；若整条公告无任何可投影版本则整体跳过，
 *   绝不把异常结构呈现给用户，也绝不覆盖上一次已审核数据。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma.service.js';
import type {
  AnnouncementVersion,
  RecruitmentAnnouncement,
} from '../matching/types.js';
import { currentVersion } from '../matching/engine.js';
import { ProjectionError, projectCatalogVersion } from './publication-projector.js';

/** 目录可见的版本状态；published 为事实，另两者仅服务审计链与失败回退 */
const CATALOG_STATUSES = ['published', 'superseded', 'withdrawn'] as const;

interface RawPublishedRow {
  id: string;
  announcementId: string;
  versionNumber: number;
  status: string;
  payload: unknown;
  publishedAt: Date;
  previousVersionId: string | null;
  supersededAt: Date | null;
}

export interface CatalogUnitRef {
  announcement: RecruitmentAnnouncement;
  version: AnnouncementVersion;
  unit: AnnouncementVersion['units'][number];
}

@Injectable()
export class PublishedCatalogRepository {
  private readonly logger = new Logger(PublishedCatalogRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 当前已发布目录。
   * @param now 供新鲜度/审计口径使用的评估时刻（引擎另行判定时效闸门）
   */
  async listPublished(now: Date): Promise<RecruitmentAnnouncement[]> {
    const rows = (await this.prisma.publishedAnnouncementVersion.findMany({
      where: { status: { in: [...CATALOG_STATUSES] } },
      orderBy: [{ announcementId: 'asc' }, { versionNumber: 'desc' }],
    })) as unknown as RawPublishedRow[];

    const grouped = new Map<string, RawPublishedRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.announcementId) ?? [];
      list.push(row);
      grouped.set(row.announcementId, list);
    }

    const catalog: RecruitmentAnnouncement[] = [];
    for (const [announcementId, list] of grouped) {
      const assembled = this.assemble(announcementId, list, now);
      if (assembled) catalog.push(assembled);
    }
    return catalog;
  }

  /** 按单元 id 取目录中的当前有效版本（不读静态目录） */
  async getUnit(unitId: string, now: Date): Promise<CatalogUnitRef | null> {
    const catalog = await this.listPublished(now);
    for (const announcement of catalog) {
      const version = currentVersion(announcement);
      const unit = version.units.find((candidate) => candidate.id === unitId);
      if (unit) return { announcement, version, unit };
    }
    return null;
  }

  private assemble(
    announcementId: string,
    rows: RawPublishedRow[],
    now: Date,
  ): RecruitmentAnnouncement | null {
    const versions: AnnouncementVersion[] = [];
    let announcement: RecruitmentAnnouncement | null = null;

    // rows 已按 versionNumber 降序：首个可投影行即当前事实版本
    for (const row of rows) {
      try {
        const projected = projectCatalogVersion(row, now);
        versions.push(projected.version);
        if (!announcement) announcement = projected.announcement;
      } catch (error) {
        // 仅结构异常（ProjectionError）跳过该行：上一版数据仍在，坏版本不进用户端；
        // 其他错误（如 DB 层异常）继续抛出，不静默。
        if (!(error instanceof ProjectionError)) throw error;
        // 告警只记录定位信息（版本行 id / 字段路径 / 消息），绝不记录 payload 正文
        this.logger.warn(
          `目录投影失败，已跳过（publishedVersionId=${row.id} announcement=${announcementId} version=${row.versionNumber} fieldPath=${error.fieldPath}）：${error.message}`,
        );
      }
    }

    if (!announcement) {
      this.logger.warn(
        `公告 ${announcementId} 无任何可投影的已发布版本，已整体跳过`,
      );
      return null;
    }

    return { ...announcement, versions };
  }
}
