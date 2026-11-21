/**
 * 单位关注领域规则测试（D07 / PRD 11.8 U07）。
 * 与后端 organization-follow.domain.spec.ts 同口径：
 * 精确身份键、首同步基线回填、每版本一次幂等、触发口径闸门。
 */
import { describe, expect, it } from "vitest";
import type {
  AnnouncementVersion,
  ApplicationUnit,
  RecruitmentAnnouncement,
} from "@/lib/announcements/types";
import {
  normalizePublisherName,
  organizationDedupKey,
  organizationIdentityKey,
  planOrganizationNotices,
  type OrganizationFollowRecord,
} from "./organization-follow";

const NOW = new Date("2026-10-28T12:00:00+08:00");

function makeVersion(
  id: string,
  announcementId: string,
  overrides: Partial<AnnouncementVersion["timeline"]> = {},
): AnnouncementVersion {
  return {
    id,
    announcementId,
    versionNumber: 1,
    sourceKind: "original",
    publishedAt: "2026-03-01T10:00:00+08:00",
    officialSource: {
      id: `${id}-src`,
      locator: { kind: "url", url: "https://example.gov.cn/a" },
      state: "official",
      checkedAt: "2026-03-01T10:00:00+08:00",
    },
    timeline: {
      registrationStart: "2026-10-01",
      registrationEnd: "2026-11-20",
      ...overrides,
    },
    units: [],
  };
}

function makeUnit(id: string, announcementId: string, versionId: string): ApplicationUnit {
  return {
    id,
    code: id,
    name: `单元${id}`,
    announcementId,
    versionId,
    region: { code: "330000", province: "浙江省" },
    subject: "chinese",
    stage: "high",
    headcount: 1,
    organizationType: "government_unified",
    employmentNature: { code: "public_institution_staff", officialName: "事业编制" },
    allocation: { code: "direct_school", description: "直接定岗" },
    requirements: [],
  };
}

function makeAnnouncement(
  id: string,
  overrides: Partial<RecruitmentAnnouncement> = {},
  version?: AnnouncementVersion,
): RecruitmentAnnouncement {
  const v = version ?? makeVersion(`${id}-v1`, id);
  if (v.units.length === 0) v.units = [makeUnit(`${id}-u1`, id, v.id)];
  return {
    id,
    title: `公告${id}`,
    publisher: "杭州市教育局",
    organizationType: "government_unified",
    officialUrl: "https://example.gov.cn/a",
    subjectScope: ["chinese"],
    region: { code: "330000", province: "浙江省" },
    lifecycle: "active",
    firstPublishedAt: "2026-03-01T10:00:00+08:00",
    versions: [v],
    ...overrides,
  };
}

function makeFollow(
  publisherName = "杭州市教育局",
  regionCode = "330000",
): OrganizationFollowRecord {
  return {
    identityKey: organizationIdentityKey({ publisherName, regionCode }),
    publisherName,
    regionCode,
    followedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("normalizePublisherName", () => {
  it("NFKC 规范化并折叠空白", () => {
    expect(normalizePublisherName("  杭州市　教育局 \n")).toBe("杭州市 教育局");
    // 全角字符归一为半角
    expect(normalizePublisherName("ＡＢＣ教育局")).toBe("ABC教育局");
  });
});

describe("organizationIdentityKey", () => {
  it("同名不同地区不串联", () => {
    const a = organizationIdentityKey({ publisherName: "某教育局", regionCode: "330000" });
    const b = organizationIdentityKey({ publisherName: "某教育局", regionCode: "320000" });
    expect(a).not.toBe(b);
  });

  it("规范化后同名同地区得到同一身份键", () => {
    const a = organizationIdentityKey({ publisherName: " 杭州市教育局 ", regionCode: "330000" });
    const b = organizationIdentityKey({ publisherName: "杭州市教育局", regionCode: "330000" });
    expect(a).toBe(b);
  });
});

describe("planOrganizationNotices", () => {
  it("首次同步：命中公告全部基线回填，不产生通知", () => {
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement("a"), makeAnnouncement("b")],
      follows: [makeFollow()],
      existingKeys: new Set(),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.backfillCount).toBe(2);
    expect(plan.keys.every((k) => !k.notified)).toBe(true);
  });

  it("第二次同步：新公告产生一次通知，旧键不重复", () => {
    const existing = planOrganizationNotices({
      announcements: [makeAnnouncement("a")],
      follows: [makeFollow()],
      existingKeys: new Set(),
      now: NOW,
    });
    const existingKeys = new Set(existing.keys.map((k) => k.dedupKey));

    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement("a"), makeAnnouncement("b")],
      follows: [makeFollow()],
      existingKeys,
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]!.announcementId).toBe("b");
    expect(plan.backfillCount).toBe(0);
    // 再同步一次：幂等，无新通知无新键
    const third = planOrganizationNotices({
      announcements: [makeAnnouncement("a"), makeAnnouncement("b")],
      follows: [makeFollow()],
      existingKeys: new Set([...existingKeys, ...plan.keys.map((k) => k.dedupKey)]),
      now: NOW,
    });
    expect(third.notices).toHaveLength(0);
    expect(third.keys).toHaveLength(0);
  });

  it("公告发布新版本视为新信息，允许再次提醒", () => {
    const follow = makeFollow();
    const first = planOrganizationNotices({
      announcements: [makeAnnouncement("a")],
      follows: [follow],
      existingKeys: new Set(),
      now: NOW,
    });
    const keys = new Set(first.keys.map((k) => k.dedupKey));
    const v2 = makeVersion("a-v2", "a");
    v2.versionNumber = 2;
    const plan = planOrganizationNotices({
      announcements: [makeAnnouncement("a", {}, v2)],
      follows: [follow],
      existingKeys: keys,
      now: NOW,
    });
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]!.versionId).toBe("a-v2");
  });

  it("触发口径：已撤回/非 https/来源异常/非官方证据/已截止 均不命中", () => {
    const cases: RecruitmentAnnouncement[] = [
      makeAnnouncement("withdrawn", { lifecycle: "withdrawn" }),
      makeAnnouncement("http", { officialUrl: "http://example.gov.cn/a" }),
      makeAnnouncement("unhealthy", {
        sourceHealth: { ok: false, checkedAt: "2026-10-01T00:00:00+08:00" },
      }),
      makeAnnouncement("pending", {},
        (() => {
          const v = makeVersion("pending-v1", "pending");
          v.officialSource = { ...v.officialSource, state: "pending_review" };
          return v;
        })()),
      makeAnnouncement("expired", {},
        makeVersion("expired-v1", "expired", { registrationEnd: "2026-10-01" })),
    ];
    const plan = planOrganizationNotices({
      announcements: cases,
      follows: [makeFollow()],
      existingKeys: new Set(),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.backfillCount).toBe(0);
    expect(plan.keys).toHaveLength(0);
  });

  it("同名不同地区的公告不串联到其他地区的关注", () => {
    const plan = planOrganizationNotices({
      announcements: [
        makeAnnouncement("a", { region: { code: "320000", province: "江苏省" } }),
      ],
      follows: [makeFollow("杭州市教育局", "330000")],
      existingKeys: new Set([
        // 已有历史键：非首次同步，若误命中会直接产生通知
        organizationDedupKey(makeFollow().identityKey, "old", "old-v1"),
      ]),
      now: NOW,
    });
    expect(plan.notices).toHaveLength(0);
    expect(plan.keys).toHaveLength(0);
  });
});
