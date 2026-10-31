"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { DimensionView, OpportunityRow } from "@/lib/ia/opportunities-view";
import { guestCardNextStep, type GuestCardNextStepKind } from "@/lib/ia/opportunities-view";
import { GateTag, MatchStatusTag } from "./MatchStatusTag";
import { safeOfficialLink } from "@/lib/links/official";
import { buildMapEntry } from "@/lib/opportunities/map-link";
import { schoolDisplayText } from "@/lib/opportunities/school-placement";
import { MapLink } from "@/components/opportunities/MapLink";
import { Button } from "@/components/ui/Button";

/**
 * 访客机会卡（v7.1 M4 第一层九要素 + 一个下一步）：
 * 省市区 · 学校或报考单元 · 匹配状态 · 学段学科 · 用工形式 · 招聘人数 ·
 * 报名截止 · 一条关键依据 · 一个明确下一步（四档状态对应不同主行动）。
 * 长证据（逐项条件、官方来源）按需展开，不把卡片堆成公告全文。
 * 偏好分层：地区不在意向范围显示「偏好范围外」、用工形式不符合偏好显示
 * 「不符合当前偏好」——两者都不是资格结论，不得与「明确不符合」混淆。
 * Preview 中的机会都是虚构示例，因此不提供关注或报名动作。
 *
 * 颜色全部走语义 Token（bg-surface / text-ink / bg-brand-soft 等），
 * 不再用散落的 blue-* / slate-* / red-* 等原始色阶（模块 0A 设计系统）。
 */

const DIMENSION_VALUE_META: Record<
  DimensionView["value"],
  { text: string; symbol: string; className: string }
> = {
  PASS: { text: "已满足", symbol: "✓", className: "text-success" },
  UNKNOWN: { text: "信息不足，补充后判断", symbol: "?", className: "text-warn" },
  MANUAL_REVIEW: { text: "存在歧义，建议向招聘单位确认", symbol: "!", className: "text-warn" },
  FAIL: { text: "不满足", symbol: "×", className: "text-danger" },
};

interface OpportunityCardProps {
  row: OpportunityRow;
  expanded: boolean;
  onToggle: () => void;
  priority?: boolean;
  /**
   * 展示在「偏好范围外」分区：这些单元 overall 仍是 not_eligible，
   * 但语义上只是地区意向不重叠，不能显示红色「明确不符合」标签。
   */
  regionOutOfScope?: boolean;
  /**
   * 展示在「不符合当前偏好」分区（v7.1 M3 偏好筛选）：overall 不受影响，
   * 只是用工形式不在用户当前选择的偏好内，同样不是资格不符合。
   */
  natureOutOfPreference?: boolean;
  /**
   * 四档主行动回调（v7.1 M4：初步符合→查看依据并保存；待补信息→补充一项继续判断；
   * 建议确认→查看确认要点；明确不符→查看不符合原因）。
   * 未提供时主按钮退化为展开判断依据。
   */
  onSelectNextStep?: (kind: GuestCardNextStepKind, row: OpportunityRow) => void;
}

export function OpportunityCard({
  row,
  expanded,
  onToggle,
  priority = false,
  regionOutOfScope = false,
  natureOutOfPreference = false,
  onSelectNextStep,
}: OpportunityCardProps) {
  const panelId = useId();
  const closed = row.gateCode !== null;
  const officialLink = safeOfficialLink(row.officialUrl);
  const nextStep = guestCardNextStep(row);
  const showPreferenceTag = !closed && (regionOutOfScope || natureOutOfPreference);
  // v7.1 M5：连市也未明确时 buildMapEntry 返回 null，卡片不渲染地图入口
  const mapEntry = buildMapEntry({
    city: row.region.city,
    district: row.region.district,
    schoolPlacement: row.schoolPlacement,
  });

  const handlePrimary = () => {
    if (onSelectNextStep) {
      onSelectNextStep(nextStep.kind, row);
      return;
    }
    onToggle();
  };
  const primaryLabel = onSelectNextStep ? nextStep.label : expanded ? "收起判断依据" : "查看为什么";

  return (
    <article
      className={cn(
        "rounded-xl border bg-surface",
        priority ? "border-brand ring-1 ring-brand-soft" : "border-line",
      )}
    >
      <h3 className="sr-only">{row.unitName}</h3>

      <div className="p-4">
        {/* 演示标识：访客预览中的机会均为虚拟示例，固定标出 */}
        <p className="mb-2">
          <span className="inline-flex h-6 items-center rounded bg-canvas px-2 text-xs font-medium text-ink-muted ring-1 ring-line">
            虚拟示例
          </span>
        </p>

        {/* 要素一/二/三：省市区 + 报考单元 + 匹配状态（或偏好/异常标签） */}
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold text-ink">
            <span className="font-normal text-ink-muted">{row.regionFullText}</span>
            <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">|</span>
            <span className="break-words">{row.unitName}</span>
          </p>
          {closed && row.gateCode ? (
            <GateTag code={row.gateCode} />
          ) : showPreferenceTag ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-muted">
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[10px] font-bold text-white"
              >
                ◌
              </span>
              {regionOutOfScope ? "偏好范围外" : "不符合当前偏好"}
            </span>
          ) : (
            <MatchStatusTag status={row.status} />
          )}
        </div>

        {/* 要素四/五/六：学段学科 + 用工形式 + 招聘人数 */}
        <p className="mt-2 text-sm text-ink-muted">
          {row.stageText} · {row.subjectText} · {row.natureText} · 招 {row.headcount} 人
        </p>

        {/* 学校规则（v7.1 M4）：逐校列明才给校名；录用后选岗/统一调配给官方口径；
            招聘单位与岗位组名不当作最终任教学校 */}
        <p className="mt-1 text-sm text-ink-muted" data-testid="school-placement">
          任教学校：
          {schoolDisplayText(
            { allocation: { code: row.allocationCode }, schoolPlacement: row.schoolPlacement },
            row.regionText,
          )}
        </p>

        {/* 要素七：报名截止 */}
        <p className="mt-1 text-sm text-ink-muted">
          报名{row.deadline}
        </p>

        {/* 要素八：一条关键依据或风险 */}
        <p
          className={cn(
            "mt-2 text-sm leading-6",
            closed ? "font-medium text-danger" : "text-ink-muted",
          )}
        >
          {closed ? row.gateReason : row.oneLineReason}
        </p>

        {/* 要素九：一个明确下一步（四档主行动）+ 判断依据（次级，按需展开） */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            size="sm"
            variant={expanded ? "outline" : "primary"}
            onClick={handlePrimary}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            {primaryLabel}
          </Button>
          {onSelectNextStep && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={panelId}
              className="text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {expanded ? "收起判断依据" : "查看判断依据"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div id={panelId} className="border-t border-line px-4 py-3">
          {/* 长证据 1：逐项条件，官方事实与系统判断分两栏 */}
          <p className="text-xs font-semibold text-ink-muted">为什么会得到这个判断</p>
          <ul className="mt-2 divide-y divide-line">
            {row.dimensions.map((dim) => {
              const meta = DIMENSION_VALUE_META[dim.value];
              return (
                <li key={`${row.unitId}-${dim.label}`} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{dim.label}</span>
                    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded bg-canvas px-2 text-xs font-medium", meta.className)}>
                      <span aria-hidden="true">{meta.symbol}</span>
                      {meta.text}
                    </span>
                  </div>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    <p className="rounded-md bg-canvas p-2 text-xs leading-5 text-ink">
                      <span className="block font-medium text-ink-muted">示例公告怎么写（非官方事实）</span>
                      {dim.officialRequirement ?? (
                        <span className="text-ink-muted">
                          该条件无单独原文摘录，岗位地区以岗位表对应行为准
                        </span>
                      )}
                    </p>
                    <p className="rounded-md bg-surface p-2 text-xs leading-5 text-ink ring-1 ring-line">
                      <span className="block font-medium text-ink-muted">根据你填写的信息判断</span>
                      {dim.reason}
                      {dim.value === "UNKNOWN" && (
                        <span className="mt-1 block text-warn">
                          缺少信息不是不符合，补充后会重新判断。
                        </span>
                      )}
                      {dim.value === "MANUAL_REVIEW" && (
                        <span className="mt-1 block text-warn">
                          公告表述可能有多种解释，需招聘单位确认，系统不能自动判定。
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 长证据 2：官方来源与核对时间 */}
          <p className="mt-3 text-xs font-semibold text-ink-muted">示例来源与时间</p>
          <dl className="mt-1.5 space-y-1 text-xs text-ink-muted">
            <div className="flex gap-2">
              <dt className="shrink-0">发布单位</dt>
              <dd>{row.publisher}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0">模拟核对时间</dt>
              <dd>{row.checkedAtText}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0">公告来源</dt>
              <dd>
                {officialLink ? (
                  <a href={officialLink} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:text-brand-strong">
                    打开公告（新窗口）
                  </a>
                ) : "虚构示例，无可访问的官方公告"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-ink-muted">
            演示示例，非在报岗位；字段以官方公告为准。初步匹配结果不等于保证可以报名，最终资格以招聘单位审核为准。
          </p>

          {/* v7.1 M5 地图轻量入口（展开区）：用户主动点击后新窗口打开国内地图；
              无明确市区时入口整体隐藏 */}
          {mapEntry && (
            <div className="mt-3 border-t border-line pt-3">
              <MapLink entry={mapEntry} unitId={row.unitId} from="guest_preview_card" />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
