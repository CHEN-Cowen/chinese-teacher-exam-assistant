/**
 * 枚举展示格式化测试（模块 0A）：
 * 确保用户页面不出现 internal enum 值（如 middlechinese、not_started 等）。
 */
import { describe, expect, it } from "vitest";
import {
  FOLLOW_STATUS_UI_LABELS,
  MATERIAL_STATUS_LABELS,
  STAGE_LABELS,
  SUBJECT_LABELS,
  TASK_STATUS_LABELS,
  materialStatusLabel,
  regionFullLabel,
  natureShortLabel,
  stageLabel,
  stageSubjectLabel,
  subjectLabel,
} from "./labels";

describe("学段学科枚举格式化", () => {
  it("stageLabel 把 StageCode 映射为中文", () => {
    expect(stageLabel("primary")).toBe("小学");
    expect(stageLabel("middle")).toBe("初中");
    expect(stageLabel("high")).toBe("高中");
  });

  it("subjectLabel 把 SubjectCode 映射为中文", () => {
    expect(subjectLabel("chinese")).toBe("语文");
    expect(subjectLabel("mathematics")).toBe("数学");
    expect(subjectLabel("english")).toBe("英语");
  });

  it("subjectLabel 对未知学科返回「其他学科」", () => {
    expect(subjectLabel("unknown" as never)).toBe("其他学科");
  });

  it("stageSubjectLabel 组合显示为「初中 · 语文」格式", () => {
    expect(stageSubjectLabel("middle", "chinese")).toBe("初中 · 语文");
    expect(stageSubjectLabel("primary", "mathematics")).toBe("小学 · 数学");
    expect(stageSubjectLabel("high", "english")).toBe("高中 · 英语");
  });

  it("regionFullLabel 输出完整省市区；未公布的层级省略，不猜测补齐（v7.1 M4）", () => {
    expect(regionFullLabel({ code: "330212", province: "浙江省", city: "宁波市", district: "鄞州区" })).toBe(
      "浙江省 宁波市 鄞州区",
    );
    expect(regionFullLabel({ code: "330100", province: "浙江省", city: "杭州市" })).toBe(
      "浙江省 杭州市",
    );
    expect(regionFullLabel({ code: "330000", province: "浙江省" })).toBe("浙江省");
  });

  it("STAGE_LABELS 和 SUBJECT_LABELS 不包含蛇形命名", () => {
    for (const key of Object.keys(STAGE_LABELS)) {
      expect(key).toMatch(/^[a-z]+$/);
      expect(STAGE_LABELS[key]).not.toContain(key);
    }
    for (const key of Object.keys(SUBJECT_LABELS)) {
      expect(SUBJECT_LABELS[key]).not.toContain(key);
    }
  });
});

describe("材料/关注/任务状态枚举格式化", () => {
  it("materialStatusLabel 映射公告模块材料状态", () => {
    expect(MATERIAL_STATUS_LABELS.not_started).toBe("未开始");
    expect(MATERIAL_STATUS_LABELS.in_progress).toBe("准备中");
    expect(MATERIAL_STATUS_LABELS.done).toBe("已完成");
    expect(MATERIAL_STATUS_LABELS.not_applicable).toBe("不适用");
    expect(materialStatusLabel("in_progress")).toBe("准备中");
  });

  it("FOLLOW_STATUS_UI_LABELS 映射关注状态", () => {
    expect(FOLLOW_STATUS_UI_LABELS.considering).toBe("考虑中");
    expect(FOLLOW_STATUS_UI_LABELS.preparing).toBe("准备报名");
    expect(FOLLOW_STATUS_UI_LABELS.registered).toBe("已报名");
    expect(FOLLOW_STATUS_UI_LABELS.abandoned).toBe("已放弃");
    expect(FOLLOW_STATUS_UI_LABELS.closed).toBe("已结束");
  });

  it("TASK_STATUS_LABELS 映射任务状态", () => {
    expect(TASK_STATUS_LABELS.pending).toBe("待确认");
    expect(TASK_STATUS_LABELS.not_started).toBe("未开始");
    expect(TASK_STATUS_LABELS.in_progress).toBe("准备中");
    expect(TASK_STATUS_LABELS.completed).toBe("已完成");
  });

  it("NATURE_SHORT_LABELS 映射用工性质", () => {
    expect(natureShortLabel("public_institution_staff")).toBe("事业编");
    expect(natureShortLabel("record_filing")).toBe("备案制");
    expect(natureShortLabel("post_quota")).toBe("员额制");
    expect(natureShortLabel("other")).toBe("其他官方用工");
  });
});
