/**
 * v7.2 结果页「当前条件」紧凑摘要测试（任务 §五）。
 *
 * 验证：
 * - 地区偏好、学历、专业、学段学科、用工形式偏好按固定顺序组合；
 * - 缺失字段跳过：不出现 undefined、空字符串或多余分隔符；
 * - 学段缺失时回退学科/意向学科；
 * - 「修改」入口默认第二屏并携带 returnTo。
 */
import { describe, expect, it } from "vitest";
import {
  buildConditionItems,
  buildEditConditionsHref,
} from "./condition-summary";

describe("buildConditionItems：固定顺序与组合", () => {
  it("全字段：地区 · 学历 · 专业 · 学段学科 · 用工偏好", () => {
    const items = buildConditionItems({
      regions: [{ code: "330100", province: "浙江省", city: "杭州市", level: "required" }],
      educationLevel: "bachelor",
      majorFullName: "汉语言文学",
      teacherCert: { stage: "middle", subject: "chinese" },
      employmentNaturePreference: "official_open",
    });
    expect(items).toEqual([
      "杭州市优先",
      "本科",
      "汉语言文学",
      "初中语文",
      "事业编优先",
    ]);
  });

  it("多个地区用「、」连接，可考虑级别给短文案", () => {
    const items = buildConditionItems({
      regions: [
        { code: "330100", province: "浙江省", city: "杭州市", level: "required" },
        { code: "330200", province: "浙江省", city: "宁波市", level: "consider" },
      ],
    });
    expect(items).toEqual(["杭州市优先、宁波市可考虑"]);
  });

  it("缺失字段全部跳过：无 undefined、无空字符串", () => {
    const items = buildConditionItems({
      educationLevel: "bachelor",
      employmentNaturePreference: "public_only",
    });
    expect(items).toEqual(["本科", "只看事业编"]);
    for (const item of items) {
      expect(item).toBeTruthy();
      expect(item).not.toContain("undefined");
    }
  });

  it("空对象返回空数组（调用方不渲染摘要）", () => {
    expect(buildConditionItems({})).toEqual([]);
    expect(buildConditionItems({ regions: [] })).toEqual([]);
  });

  it("专业空白字符视为缺失", () => {
    expect(buildConditionItems({ majorFullName: "   " })).toEqual([]);
  });

  it("三种用工偏好文案", () => {
    expect(
      buildConditionItems({ employmentNaturePreference: "public_only" }),
    ).toEqual(["只看事业编"]);
    expect(
      buildConditionItems({ employmentNaturePreference: "official_open" }),
    ).toEqual(["事业编优先"]);
    expect(
      buildConditionItems({ employmentNaturePreference: "undecided" }),
    ).toEqual(["全部官方岗位"]);
  });

  it("学段缺失时只显示学科", () => {
    const items = buildConditionItems({
      teacherCert: { subject: "chinese" },
    });
    expect(items).toEqual(["语文"]);
  });

  it("教资学科缺失时回退意向学科（报考语文）", () => {
    const items = buildConditionItems({ intendedSubject: "chinese" });
    expect(items).toEqual(["报考语文"]);
  });

  it("教资有学科时优先于意向学科", () => {
    const items = buildConditionItems({
      teacherCert: { stage: "middle", subject: "chinese" },
      intendedSubject: "mathematics",
    });
    expect(items).toEqual(["初中语文"]);
  });
});

describe("buildEditConditionsHref：修改条件入口", () => {
  it("默认进入第二屏，returnTo 指向原结果页", () => {
    expect(buildEditConditionsHref("/preview")).toBe(
      "/onboarding?mode=edit&step=2&returnTo=%2Fpreview",
    );
  });

  it("保留原标签状态（returnTo 携带 tab）", () => {
    const href = buildEditConditionsHref("/preview?tab=supplement");
    expect(href).toBe(
      "/onboarding?mode=edit&step=2&returnTo=%2Fpreview%3Ftab%3Dsupplement",
    );
    // 解码后能还原原路径
    const url = new URL(href, "https://local.test");
    expect(url.searchParams.get("mode")).toBe("edit");
    expect(url.searchParams.get("step")).toBe("2");
    expect(url.searchParams.get("returnTo")).toBe("/preview?tab=supplement");
  });

  it("登录机会页同样支持（/opportunities?tab=…）", () => {
    const href = buildEditConditionsHref("/opportunities?tab=outOfScope");
    const url = new URL(href, "https://local.test");
    expect(url.searchParams.get("returnTo")).toBe(
      "/opportunities?tab=outOfScope",
    );
  });
});
