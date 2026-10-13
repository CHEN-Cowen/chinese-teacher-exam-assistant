/**
 * 测试样本自检（工作包 0）。
 *
 * 锁定两件事：
 * 1. 每个机会样本在匹配引擎与机会页视图模型中落在 PRD 7.5 预期的展示分类
 *    （优先 / 补充后判断 / 偏好范围外 / 建议官方确认 / 明确不符合 / 关闭）；
 * 2. 样本自身卫生：全虚构、占位域名、dataset=test，不可能被误当生产数据。
 *
 * 若引擎或视图模型演进导致分类变化，本文件必须先于页面测试失败——
 * 这正是工作包 0 要的「旧功能被破坏能被发现」。
 */
import { describe, expect, it } from "vitest";
import { buildCandidates, isValidOpportunity } from "@/lib/matching/domain";
import { buildOpportunitiesView } from "@/lib/ia/opportunities-view";
import {
  ALL_OPPORTUNITY_SAMPLES,
  NEED_INFO_OPPORTUNITY,
  PRIORITY_OPPORTUNITY,
  REFERENCE_NOW,
} from "./samples/announcements";
import {
  COMPLETE_PROFILE,
  PROFILE_MISSING_CONDITIONAL_FACTS,
} from "./samples/profiles";
import { PUBLISHED_ANNOUNCEMENT_SAMPLE } from "./samples/published-announcement";

function unitIds(rows: { unitId: string }[]): string[] {
  return rows.map((r) => r.unitId);
}

describe("机会样本 → PRD 7.5 展示分类（完整画像）", () => {
  const view = buildOpportunitiesView(
    ALL_OPPORTUNITY_SAMPLES,
    COMPLETE_PROFILE,
    REFERENCE_NOW,
  );

  it("优先机会：初步符合，进入 preliminary", () => {
    expect(unitIds(view.preliminary)).toContain("fx-unit-priority");
  });

  it("缺事实样本在画像完整时同样初步符合（对照组）", () => {
    expect(unitIds(view.preliminary)).toContain("fx-unit-need-info");
  });

  it("资格通过但超出偏好：进入 regionOutOfScope，绝不算明确不符合", () => {
    expect(unitIds(view.regionOutOfScope)).toContain("fx-unit-out-of-preference");
    expect(unitIds(view.notEligible)).not.toContain("fx-unit-out-of-preference");
  });

  it("MANUAL_REVIEW：进入 manualReview（建议官方确认）", () => {
    expect(unitIds(view.manualReview)).toContain("fx-unit-manual-review");
  });

  it("明确 FAIL：进入 notEligible（非优先结果）", () => {
    expect(unitIds(view.notEligible)).toContain("fx-unit-fail");
  });

  it("已截止与来源失效：均不进入正常机会，保留在 closed 且原因可查", () => {
    expect(unitIds(view.closed)).toContain("fx-unit-closed");
    expect(unitIds(view.closed)).toContain("fx-unit-source-down");
    for (const id of ["fx-unit-closed", "fx-unit-source-down"]) {
      expect(unitIds(view.preliminary)).not.toContain(id);
      expect(unitIds(view.manualReview)).not.toContain(id);
    }
  });

  it("互斥不变量（KR 分类正确）：每个样本单元只属于一个展示分类", () => {
    const buckets = [
      view.preliminary,
      view.manualReview,
      view.notEligible,
      view.regionOutOfScope,
      view.closed,
      ...view.needInfoGroups.map((g) => g.rows),
    ];
    const seen = new Map<string, number>();
    for (const rows of buckets) {
      for (const row of rows) seen.set(row.unitId, (seen.get(row.unitId) ?? 0) + 1);
    }
    for (const [unitId, count] of seen) {
      expect(count, `${unitId} 出现在 ${count} 个分类`).toBe(1);
    }
  });
});

describe("缺事实画像 → 补充后重算（链路②样本行为）", () => {
  it("缺户籍/出生日期时：两个样本都进入「补充后判断」，UNKNOWN 不转成 FAIL", () => {
    const view = buildOpportunitiesView(
      [PRIORITY_OPPORTUNITY, NEED_INFO_OPPORTUNITY],
      PROFILE_MISSING_CONDITIONAL_FACTS,
      REFERENCE_NOW,
    );
    const needInfoUnitIds = view.needInfoGroups.flatMap((g) => unitIds(g.rows));
    expect(needInfoUnitIds).toContain("fx-unit-priority");
    expect(needInfoUnitIds).toContain("fx-unit-need-info");
    expect(view.preliminary).toHaveLength(0);
    // 没有任何维度被判 FAIL
    const candidates = buildCandidates(
      [PRIORITY_OPPORTUNITY, NEED_INFO_OPPORTUNITY],
      PROFILE_MISSING_CONDITIONAL_FACTS,
      REFERENCE_NOW,
    );
    for (const c of candidates) {
      expect(c.match.dimensions.every((d) => d.value !== "FAIL")).toBe(true);
      expect(c.match.overall).toBe("need_more_info");
    }
  });

  it("补全户籍与出生日期后重算：两个样本都变为初步符合（补充→重算→换分类）", () => {
    const before = buildOpportunitiesView(
      [PRIORITY_OPPORTUNITY, NEED_INFO_OPPORTUNITY],
      PROFILE_MISSING_CONDITIONAL_FACTS,
      REFERENCE_NOW,
    );
    const after = buildOpportunitiesView(
      [PRIORITY_OPPORTUNITY, NEED_INFO_OPPORTUNITY],
      COMPLETE_PROFILE,
      REFERENCE_NOW,
    );
    expect(before.preliminary).toHaveLength(0);
    expect(unitIds(after.preliminary)).toEqual(
      expect.arrayContaining(["fx-unit-priority", "fx-unit-need-info"]),
    );
  });
});

describe("闸门语义（已截止 / 来源失效 / 其他闸门全过）", () => {
  const candidates = buildCandidates(
    ALL_OPPORTUNITY_SAMPLES,
    COMPLETE_PROFILE,
    REFERENCE_NOW,
  );
  const byUnit = new Map(candidates.map((c) => [c.unit.id, c]));

  it("已截止样本：registration_closed 失败，其余闸门通过（变量隔离）", () => {
    const c = byUnit.get("fx-unit-closed")!;
    expect(c.match.gates.find((g) => g.code === "registration_closed")?.passed).toBe(false);
    expect(
      c.match.gates.filter((g) => g.code !== "registration_closed").every((g) => g.passed),
    ).toBe(true);
    expect(isValidOpportunity(c.match)).toBe(false);
  });

  it("来源失效样本：source_unavailable 失败，报名未截止（与已截止区分）", () => {
    const c = byUnit.get("fx-unit-source-down")!;
    expect(c.match.gates.find((g) => g.code === "source_unavailable")?.passed).toBe(false);
    expect(c.match.gates.find((g) => g.code === "registration_closed")?.passed).toBe(true);
    expect(isValidOpportunity(c.match)).toBe(false);
  });

  it("MANUAL_REVIEW 样本：专业歧义维度为 MANUAL_REVIEW，总档 manual_review", () => {
    const c = byUnit.get("fx-unit-manual-review")!;
    const major = c.match.dimensions.find((d) => d.dimension === "major")!;
    expect(major.value).toBe("MANUAL_REVIEW");
    expect(c.match.overall).toBe("manual_review");
  });

  it("FAIL 样本：学历硬性 FAIL，总档 not_eligible", () => {
    const c = byUnit.get("fx-unit-fail")!;
    const edu = c.match.dimensions.find((d) => d.dimension === "education")!;
    expect(edu.value).toBe("FAIL");
    expect(edu.hard).toBe(true);
    expect(c.match.overall).toBe("not_eligible");
  });

  it("偏好范围外样本：唯一 FAIL 维度是 region", () => {
    const c = byUnit.get("fx-unit-out-of-preference")!;
    const fails = c.match.dimensions.filter((d) => d.value === "FAIL");
    expect(fails).toHaveLength(1);
    expect(fails[0]!.dimension).toBe("region");
  });
});

describe("数据库已发布公告样本（链路③输入）", () => {
  it("具备 Prisma PublishedAnnouncementVersion 全部持久化字段", () => {
    const s = PUBLISHED_ANNOUNCEMENT_SAMPLE;
    expect(s.id).toBeTruthy();
    expect(s.announcementId).toBeTruthy();
    expect(s.runId).toBeTruthy();
    expect(s.versionNumber).toBe(1);
    expect(s.status).toBe("published");
    expect(typeof s.publishedAt).toBe("string");
    expect(s.previousVersionId).toBeNull();
    expect(s.supersededAt).toBeNull();
  });

  it("payload 含可还原为公告+版本+单元的结构，且显式 dataset=test", () => {
    const payload = PUBLISHED_ANNOUNCEMENT_SAMPLE.payload as {
      dataset: string;
      announcement: { id: string; officialUrl: string };
      version: { timeline: { registrationEnd: string }; units: { id: string }[] };
    };
    expect(payload.dataset).toBe("test");
    expect(payload.announcement.id).toBe(PUBLISHED_ANNOUNCEMENT_SAMPLE.announcementId);
    expect(payload.version.units.length).toBeGreaterThan(0);
    expect(payload.version.timeline.registrationEnd).toBeTruthy();
  });
});

describe("样本卫生（不可能被误当生产数据）", () => {
  it("所有机会样本标题带【测试】前缀，官方链接使用占位域名", () => {
    for (const a of ALL_OPPORTUNITY_SAMPLES) {
      expect(a.title).toContain("【测试】");
      expect(a.officialUrl).toContain("example.gov.cn");
      expect(a.publisher).toContain("测试");
    }
  });

  it("样本不指向任何真实生产来源域名", () => {
    const text = JSON.stringify(ALL_OPPORTUNITY_SAMPLES) + JSON.stringify(PUBLISHED_ANNOUNCEMENT_SAMPLE);
    expect(text).not.toMatch(/hzedu\.gov\.cn|nbedu\.net\.cn|nbyz\.gov\.cn|yinzhou/);
  });
});
