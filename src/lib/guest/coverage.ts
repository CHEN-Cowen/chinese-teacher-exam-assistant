/**
 * 访客侧「真实官方监测覆盖」事实源（模块 4）。
 *
 * 访客首页 /onboarding /preview 不调用后端，无法从 match 响应拿 coverage，
 * 因此在此镜像后端 backend/src/matching/coverage.ts 的 REAL_COVERAGE。
 * 两处必须人工保持一致：后端巡检结论更新时，同步本文件与 GUEST_COVERAGE_LAST_UPDATED。
 */
import type { CoverageDTO } from "@/lib/opportunities/api-types";

/** 本镜像最近一次与后端核对的日期（代码维护用，展示取 coverage.lastCheckedAt） */
export const GUEST_COVERAGE_LAST_UPDATED = "2026-10-06";

export const GUEST_COVERAGE: CoverageDTO = {
  version: "kb-monitoring-coverage-1.1.0",
  subject: "chinese",
  subjectLabel: "语文教师",
  status: "monitoring_no_open",
  provinces: [
    {
      code: "330000",
      label: "浙江省",
      status: "monitoring_no_open",
      monitoredRegionCodes: ["330100", "330200"],
      scopeNote:
        "浙江已监测杭州、宁波（含鄞州等区县）两市教育/人社官方栏目；省内其余城市暂未收录，「暂未收录」不代表当地没有招聘。",
    },
    {
      code: "320000",
      label: "江苏省",
      status: "not_started",
      monitoredRegionCodes: [],
      scopeNote:
        "江苏尚未开始官方渠道监测：首批监测城市将依据受邀试用用户的报考意向确定后接入；接入前江苏全省均为「暂未收录」，不代表当地没有招聘，也没有可核对的官方来源。",
    },
  ],
  regions: [
    {
      code: "330100",
      label: "浙江·杭州",
      authority: "杭州市教育局",
      sources: [
        {
          id: "src-hz-edu-recruit",
          name: "杭州教育网 · 教师招聘栏目",
          url: "https://edu.hangzhou.gov.cn/col/col1228921906/index.html",
          lastCheckedAt: "2026-10-06T11:30:00+08:00",
          ok: true,
          failReason: null,
        },
      ],
    },
    {
      code: "330200",
      label: "浙江·宁波（含鄞州等区县）",
      authority: "宁波市教育局、鄞州区教育局",
      sources: [
        {
          id: "src-nb-edu-recruit",
          name: "宁波市教育局 · 人才招聘栏目",
          url: "http://jyj.ningbo.gov.cn/col/col1229166692/index.html",
          lastCheckedAt: "2026-10-06T11:30:00+08:00",
          ok: true,
          failReason: null,
        },
        {
          id: "src-yz-edu-recruit",
          name: "鄞州区政府 · 教育局事业招聘栏目",
          url: "https://www.nbyz.gov.cn/col/col1229117192/index.html",
          lastCheckedAt: "2026-10-06T11:30:00+08:00",
          ok: true,
          failReason: null,
        },
      ],
    },
  ],
  lastCheckedAt: "2026-10-06T11:30:00+08:00",
  openOpportunityCount: 0,
  nextWindowNote:
    "按往年节奏，下一窗口预计在 2026 年 11—12 月（提前批/冬季批）；鄞州 7 月 31 日预告批次的报名时间待官方通知，会持续跟踪。",
  scopeNote:
    "真实监测目前仅覆盖浙江杭州、宁波两市教育/人社官方渠道；江苏省尚未开始监测，浙江其余城市与江苏全部城市当前均为「暂未收录」；「暂未收录」不代表当地没有招聘。",
};
