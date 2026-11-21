/**
 * 单位关注领域规则（D07 / PRD 11.8 U07）：纯函数，与后端
 * backend/src/opportunities/organization-follow.domain.ts 同口径。
 *
 * 不变量：
 * - 单位身份键 = 规范化发布主体名 + 公告级地区码，仅精确匹配关联新公告；
 *   同名不同地区不串联，更名/合并不做模糊推断（关联不确定不自动发布关系）。
 * - 提醒触发口径与订阅一致（官方来源、未过期、已人工核对、用户可见），
 *   只是匹配条件从「地区+学科」换成「单位身份」。
 * - 幂等：dedupKey = `org:{identityKey}:{announcementId}:{versionId}`；
 *   每个关注首次同步做基线回填（notified=false），不产生通知风暴；
 *   公告发布新版本视为新信息，允许再次提醒（仍每版本一次）。
 */
import { currentVersion } from "@/lib/announcements/domain";
import type { RecruitmentAnnouncement } from "@/lib/announcements/types";
import { chinaToday } from "@/lib/history/domain";

export interface OrganizationIdentity {
  publisherName: string;
  regionCode: string;
}

/** 规范化发布主体名：NFKC + 折叠空白。刻意保守：不去括号、不做相似度推断 */
export function normalizePublisherName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function organizationIdentityKey(
  identity: OrganizationIdentity,
): string {
  return `${normalizePublisherName(identity.publisherName)}@${identity.regionCode}`;
}

/** 单位关注记录（存储无关形状；DTO/本地行序列化后即该形状） */
export interface OrganizationFollowRecord {
  identityKey: string;
  publisherName: string;
  regionCode: string;
  followedAt: string;
}

export interface OrganizationNotice {
  identityKey: string;
  announcementId: string;
  versionId: string;
  /** 用于跳转详情的一个在报单元（同公告多单元时取第一个） */
  unitId: string;
  unitName: string;
  publisher: string;
  announcementTitle: string;
  regionLabel: string;
  registrationEnd: string;
  unitCount: number;
}

export interface OrganizationNoticeKey {
  identityKey: string;
  announcementId: string;
  versionId: string;
  dedupKey: string;
  /** true=本次产生站内通知；false=该关注首次同步基线回填 */
  notified: boolean;
}

export function organizationDedupKey(
  identityKey: string,
  announcementId: string,
  versionId: string,
): string {
  return `org:${identityKey}:${announcementId}:${versionId}`;
}

/**
 * 计划单位关注的提醒与幂等键。
 * - existingKeys 为该用户全部已记录键，函数内部按 `org:{identityKey}:` 前缀
 *   筛出每个关注自己的历史；
 * - 某关注没有任何历史键 = 该关注首次同步：命中公告全部基线回填不通知；
 * - 之后该关注出现新 dedupKey 才产生通知。
 *
 * 前端 demo 目录均为已人工核对的演示数据，不重复后端 reviewStatus 闸门；
 * 其余触发口径（生命周期/官方来源/未截止/来源健康）与后端一致。
 */
export function planOrganizationNotices(input: {
  announcements: readonly RecruitmentAnnouncement[];
  follows: readonly OrganizationFollowRecord[];
  existingKeys: ReadonlySet<string>;
  now: Date;
}): {
  notices: OrganizationNotice[];
  keys: OrganizationNoticeKey[];
  backfillCount: number;
} {
  const { announcements, follows, existingKeys, now } = input;
  const notices: OrganizationNotice[] = [];
  const keys: OrganizationNoticeKey[] = [];
  let backfillCount = 0;
  if (follows.length === 0) return { notices, keys, backfillCount };

  const today = chinaToday(now);

  // 按身份键索引当前可提醒的公告（同一公告对多个关注只算一次）
  const byIdentity = new Map<
    string,
    Array<{ announcement: RecruitmentAnnouncement; versionId: string }>
  >();
  for (const announcement of announcements) {
    if (announcement.lifecycle !== "active") continue;
    if (!announcement.officialUrl.startsWith("https://")) continue;
    if (announcement.sourceHealth?.ok === false) continue;
    const version = currentVersion(announcement);
    if (version.officialSource.state !== "official") continue;
    const registrationEnd = version.timeline.registrationEnd;
    if (!registrationEnd || registrationEnd.slice(0, 10) < today) continue;
    const key = organizationIdentityKey({
      publisherName: announcement.publisher,
      regionCode: announcement.region.code,
    });
    const list = byIdentity.get(key) ?? [];
    list.push({ announcement, versionId: version.id });
    byIdentity.set(key, list);
  }

  for (const follow of follows) {
    const prefix = `org:${follow.identityKey}:`;
    const ownKeys = new Set(
      [...existingKeys].filter((k) => k.startsWith(prefix)),
    );
    const isFirstSync = ownKeys.size === 0;
    for (const hit of byIdentity.get(follow.identityKey) ?? []) {
      const { announcement, versionId } = hit;
      const version = announcement.versions.find((v) => v.id === versionId);
      if (!version) continue;
      const dedupKey = organizationDedupKey(
        follow.identityKey,
        announcement.id,
        versionId,
      );
      if (existingKeys.has(dedupKey)) continue;

      if (isFirstSync) {
        keys.push({
          identityKey: follow.identityKey,
          announcementId: announcement.id,
          versionId,
          dedupKey,
          notified: false,
        });
        backfillCount += 1;
        continue;
      }
      const unit = version.units[0];
      if (!unit) continue;
      const registrationEnd = version.timeline.registrationEnd;
      if (!registrationEnd) continue;
      notices.push({
        identityKey: follow.identityKey,
        announcementId: announcement.id,
        versionId,
        unitId: unit.id,
        unitName: unit.name,
        publisher: announcement.publisher,
        announcementTitle: announcement.title,
        regionLabel: [
          announcement.region.province,
          announcement.region.city,
          announcement.region.district,
        ]
          .filter(Boolean)
          .join(" "),
        registrationEnd,
        unitCount: version.units.length,
      });
      keys.push({
        identityKey: follow.identityKey,
        announcementId: announcement.id,
        versionId,
        dedupKey,
        notified: true,
      });
    }
  }

  return { notices, keys, backfillCount };
}
