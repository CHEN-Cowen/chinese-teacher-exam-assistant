/**
 * 新机会订阅领域规则（v7.1 M6）：纯函数，不含存储与框架代码。
 *
 * 提醒触发条件（PRD v7.1 §5.7）：只有同时满足以下条件的公告可以触发新机会提醒——
 * 1. 官方来源（版本证据锚点 state=official 且公告来源健康、officialUrl 为 https）；
 * 2. 未过期（报名截止日期 >= 今天；官方未公布截止日期时无法确认未过期，不提醒）；
 * 3. 已人工核对（演示台账为人工维护的示例内容；真实台账必须 human_reviewed）；
 * 4. 地区和学科相符（订阅地区前缀匹配 + 单元学科等于订阅学科）；
 * 5. 没有已知明确不符合项（当前画像匹配中该单元不是 not_eligible）。
 *
 * 幂等：dedupKey = `${announcementId}:${versionId}`，同一用户和公告在同一发布版本下
 * 只提醒一次；首次同步对既有匹配公告做基线回填（notified=false），不产生通知风暴；
 * 公告发布新版本视为新信息，允许再次提醒（仍每版本一次）。
 */
import { currentVersion } from '../matching/engine.js';
import type {
  AnnouncementVersion,
  ApplicationUnit,
  RecruitmentAnnouncement,
  RegionRef,
  UserRecruitmentProfile,
} from '../matching/types.js';

export type NaturePreferenceCode = 'public_only' | 'official_open' | 'undecided';

export interface SubscriptionCriteria {
  regions: Array<{
    code: string;
    province: string;
    city?: string;
    district?: string;
  }>;
  subject: string;
  naturePreference: NaturePreferenceCode;
}

export interface PlannedNotice {
  announcementId: string;
  versionId: string;
  unitId: string;
  unitName: string;
  publisher: string;
  regionLabel: string;
  stage: string;
  subject: string;
  headcount: number;
  registrationEnd: string | null;
  officialUrl: string;
}

export interface PlannedKey {
  announcementId: string;
  versionId: string;
  dedupKey: string;
  /** true=本次产生站内通知；false=首次同步基线回填 */
  notified: boolean;
}

export interface PlanOpportunityNoticesInput {
  announcements: readonly RecruitmentAnnouncement[];
  criteria: SubscriptionCriteria;
  /** 用户当前画像匹配中明确不符合（not_eligible）的单元 id */
  ineligibleUnitIds: ReadonlySet<string>;
  /** 该用户已记录的 dedupKey（空 = 首次同步，做基线回填） */
  existingKeys: ReadonlySet<string>;
  now: Date;
}

export interface PlanOpportunityNoticesResult {
  notices: PlannedNotice[];
  keys: PlannedKey[];
  /** 首次同步回填的基线数量（不产生通知） */
  backfillCount: number;
}

/**
 * 从画像派生订阅默认条件：地区、语文学科、用工偏好。
 * 用工偏好口径与 M3 三档一致：只接受事业编 → public_only；
 * 接受任意官方用工 → official_open；未选择 → undecided。
 */
export function deriveSubscriptionCriteria(
  profile: UserRecruitmentProfile,
): SubscriptionCriteria {
  // v7.2：优先用 onboarding 第二屏收集的显式偏好；旧画像回退到白名单派生
  const naturePreference: NaturePreferenceCode =
    profile.employmentNaturePreference ??
    ((): NaturePreferenceCode => {
      const accepted = profile.acceptedEmploymentNatures ?? [];
      if (accepted.length === 0) return 'undecided';
      if (
        accepted.length === 1 &&
        accepted[0] === 'public_institution_staff'
      ) {
        return 'public_only';
      }
      return 'official_open';
    })();
  return {
    // 画像地区无 district 维度；匹配只依赖 code 前缀
    regions: profile.regions.map((r) => ({
      code: r.code,
      province: r.province,
      ...(r.city ? { city: r.city } : {}),
    })),
    subject: 'chinese',
    naturePreference,
  };
}

/** 订阅地区是否覆盖单元地区：省级认同省前缀，市级认同市前缀，区县级只认精确匹配。 */
export function subscriptionRegionMatches(
  prefCode: string,
  unitRegion: RegionRef,
): boolean {
  if (prefCode.length !== 6 || unitRegion.code.length !== 6) return false;
  if (prefCode === unitRegion.code) return true;
  if (prefCode.slice(2, 6) === '0000') {
    return prefCode.slice(0, 2) === unitRegion.code.slice(0, 2);
  }
  if (prefCode.slice(4, 6) === '00') {
    return prefCode.slice(0, 4) === unitRegion.code.slice(0, 4);
  }
  return false;
}

function natureMatches(
  naturePreference: NaturePreferenceCode,
  unit: ApplicationUnit,
): boolean {
  switch (naturePreference) {
    case 'public_only':
      return unit.employmentNature.code === 'public_institution_staff';
    case 'official_open':
    case 'undecided':
      return true;
  }
}

/** 中国时区「今天」的 ISO 日期（YYYY-MM-DD），用于报名截止比较。 */
export function chinaTodayIso(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 单个公告版本是否满足提醒触发条件；返回第一个符合的单元（无则 null）。 */
export function firstQualifyingUnit(
  input: {
    announcement: RecruitmentAnnouncement;
    version: AnnouncementVersion;
    criteria: SubscriptionCriteria;
    ineligibleUnitIds: ReadonlySet<string>;
    now: Date;
  },
): ApplicationUnit | null {
  const { announcement, version, criteria, ineligibleUnitIds, now } = input;

  // 2. 未过期：官方未公布截止日期时无法确认未过期，保守不提醒
  const registrationEnd = version.timeline.registrationEnd;
  if (!registrationEnd) return null;
  if (registrationEnd < chinaTodayIso(now)) return null;

  // 1. 官方来源：证据锚点官方 + 来源健康 + https 官网
  if (version.officialSource.state !== 'official') return null;
  if (announcement.sourceHealth?.ok === false) return null;
  if (!announcement.officialUrl.startsWith('https://')) return null;

  // 3. 已人工核对：演示台账（缺省 dataset 视为 demo）为人工维护示例；
  //    真实台账必须 human_reviewed
  if (announcement.lifecycle !== 'active') return null;
  const dataset = announcement.dataset ?? 'demo';
  if (dataset !== 'demo' && announcement.reviewStatus !== 'human_reviewed') {
    return null;
  }

  // 4/5. 地区、学科、用工偏好与已知明确不符合项按单元判定
  for (const unit of version.units) {
    if (unit.subject !== criteria.subject) continue;
    if (ineligibleUnitIds.has(unit.id)) continue;
    if (!natureMatches(criteria.naturePreference, unit)) continue;
    const matched = criteria.regions.some((r) =>
      subscriptionRegionMatches(r.code, unit.region),
    );
    if (!matched) continue;
    return unit;
  }
  return null;
}

/**
 * 计划本次同步的提醒与幂等键。
 * - 已记录的 dedupKey 跳过（重复同步幂等）；
 * - 首次同步（existingKeys 为空）：全部记为基线回填 notified=false，不产生通知；
 * - 后续同步：新 dedupKey 产生一条通知 + notified=true 的日志。
 */
export function planOpportunityNotices(
  input: PlanOpportunityNoticesInput,
): PlanOpportunityNoticesResult {
  const { announcements, criteria, ineligibleUnitIds, existingKeys, now } =
    input;
  const isFirstSync = existingKeys.size === 0;

  const notices: PlannedNotice[] = [];
  const keys: PlannedKey[] = [];
  let backfillCount = 0;

  for (const announcement of announcements) {
    const version = currentVersion(announcement);
    const registrationEnd = version.timeline.registrationEnd;
    if (!registrationEnd) continue;
    const unit = firstQualifyingUnit({
      announcement,
      version,
      criteria,
      ineligibleUnitIds,
      now,
    });
    if (!unit) continue;

    const dedupKey = `${announcement.id}:${version.id}`;
    if (existingKeys.has(dedupKey)) continue;

    if (isFirstSync) {
      keys.push({
        announcementId: announcement.id,
        versionId: version.id,
        dedupKey,
        notified: false,
      });
      backfillCount += 1;
      continue;
    }

    const regionParts = [unit.region.province, unit.region.city, unit.region.district]
      .filter(Boolean)
      .join(' ');
    notices.push({
      announcementId: announcement.id,
      versionId: version.id,
      unitId: unit.id,
      unitName: unit.name,
      publisher: announcement.publisher,
      regionLabel: regionParts,
      stage: unit.stage,
      subject: unit.subject,
      headcount: unit.headcount,
      registrationEnd,
      officialUrl: announcement.officialUrl,
    });
    keys.push({
      announcementId: announcement.id,
      versionId: version.id,
      dedupKey,
      notified: true,
    });
  }

  return { notices, keys, backfillCount };
}
