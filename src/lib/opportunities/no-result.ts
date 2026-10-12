/**
 * 无结果反馈状态机（v7.1 M6，纯函数）。
 *
 * 无结果必须区分三种状态（PRD v7.1 §5.7），不得笼统显示“没有适合你的岗位”：
 * 1. region_uncovered    当前地区暂未覆盖（≠ 当地没有招聘）；
 * 2. no_open_recruitment 已覆盖范围当前没有开放招聘；
 * 3. qualification_gap   存在岗位但资格暂不满足（含待补信息/需人工确认/已截止）。
 *
 * 判定优先级：有可行动机会 → 不是无结果（null）；
 * 目录里看得到任何单元（不符合/截止/待补/待确认）→ 资格暂不满足；
 * 否则画像有暂未收录地区 → 地区未覆盖；剩下 → 已覆盖但当前无开放招聘。
 */
import type { OpportunityListViewModel } from "./list-view";

export type NoResultKind =
  | "region_uncovered"
  | "no_open_recruitment"
  | "qualification_gap";

export interface NoResultState {
  kind: NoResultKind;
  title: string;
  reason: string;
  nextStep: string;
}

export function buildNoResultState(
  view: OpportunityListViewModel,
): NoResultState | null {
  if (view.validCount > 0) return null;

  const visibleUnits =
    view.notEligible.length +
    view.closed.length +
    view.regionOutOfScope.length +
    view.manualReview.length +
    view.needInfoGroups.reduce((sum, g) => sum + g.units.length, 0);

  if (visibleUnits > 0) {
    return {
      kind: "qualification_gap",
      title: "有岗位，但你的条件暂时对不上",
      reason: "监测范围内存在招聘公告，但逐项核对后没有初步符合的机会；具体原因见下方各卡片与详情页逐条件说明。",
      nextStep: "核对不符合项：有些条件（如户籍、职称）可在报名前补齐或向招聘单位确认；确认无误后可订阅新公告，出现符合条件的新岗位时在站内提醒你。",
    };
  }

  if (view.uncoveredRegions.length > 0) {
    return {
      kind: "region_uncovered",
      title: "你选择的地区暂未收录官方公告",
      reason: "暂未收录不等于当地没有招聘：可能公告尚未发布，或该地区还没进入我们的监测范围。我们不猜测当地情况。",
      nextStep: "报名前以当地教育局、人社局官网为准；也可以先订阅，该地区进入监测范围并核对到公告后会在站内提醒你。",
    };
  }

  return {
    kind: "no_open_recruitment",
    title: "监测范围内当前没有开放报名的招聘",
    reason: "我们持续核对覆盖地区的官方来源，当前核对时点没有在报的招聘岗位；这是核对结果，不代表之后不会有。",
    nextStep: "订阅新机会提醒：已人工核对的匹配公告发布后，会在站内通知中心提醒你一次；也可以先准备报名材料。",
  };
}
