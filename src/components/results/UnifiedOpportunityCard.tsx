"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GateTag, MatchStatusTag } from "@/components/ia/MatchStatusTag";
import { MAP_LINK_LABEL, MAP_LINK_PROPS } from "@/lib/opportunities/map-link";
import { safeOfficialLink } from "@/lib/links/official";
import type {
  OpportunityCardViewModel,
  ResultsCardVariant,
} from "@/lib/results/workbench-view";

/**
 * 卡片能力对象：身份差异（访客/登录）只通过 capabilities 表达，
 * 卡片 DOM 层级、地图位置、按钮尺寸、响应式行为完全同一份。
 */
export interface OpportunityCardCapabilities {
  /** 是否提供保存操作 */
  canSave: boolean;
  /** 保存按钮文案（默认「保存机会」；登录已保存时为「移除保存」） */
  saveLabel?: string;
  /** 保存请求进行中（尺寸不变，只换文案与 disabled） */
  saveBusy?: boolean;
  onSave?: () => void;
  /** 「查看官方依据」为链接（登录端 → 详情页） */
  evidenceHref?: string;
  /** 「查看官方依据」按钮文案 */
  evidenceLabel?: string;
  /** 「查看官方依据」为展开动作（访客端 → 展开演示依据面板） */
  onViewEvidence?: () => void;
}

interface UnifiedOpportunityCardProps {
  vm: OpportunityCardViewModel;
  variant: ResultsCardVariant;
  capabilities: OpportunityCardCapabilities;
  /** 操作区下方的附加内容（登录端 follow 状态行 / 官方原文链接） */
  afterActions?: ReactNode;
  /** 默认展开的依据区附加内容（登录端 defaultExpanded 的条件核对） */
  expandedExtra?: ReactNode;
}

/**
 * v7.2 统一岗位卡（唯一实现，/preview 与 /opportunities 共用）。
 *
 * 固定七层 DOM 顺序（所有 variant 一致，状态差异只改视觉不改位置）：
 * 1. 真实/演示标识（dataset-tag） + 截止时间（deadline-text）
 * 2. 岗位名称（opportunity-title）
 * 3. 地点 · 任教学校 + 地图入口（location-row > map-link）
 * 4. 用工形式 · 学段学科 · 招聘人数（job-facts）
 * 5. 资格判断摘要（decision-summary）
 * 6. 一个关键风险或待补信息
 * 7. 查看官方依据（view-evidence-button，实心主按钮） + 保存机会（save-button，描边次按钮）
 *
 * 按钮系统：两按钮同高 h-11、同圆角 rounded-xl、同一基线；
 * 移动端整宽纵向堆叠，桌面端并排；loading/disabled 不改变尺寸。
 *
 * 响应式：移动端单列；桌面 1024+ 双区（左区岗位事实 7 栏 + 右区判断 5 栏，
 * 第 1、7 层跨满宽），页面不再是放大的手机布局。
 */
export function UnifiedOpportunityCard({
  vm,
  variant,
  capabilities,
  afterActions,
  expandedExtra,
}: UnifiedOpportunityCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const isPriority = variant === "priority";
  const isOutOfScope = variant === "outOfScope";
  const isConsult = vm.isConsult && variant === "supplement";

  const evidenceLabel =
    capabilities.evidenceLabel ??
    (isConsult ? "查看需要确认的问题" : "查看官方依据");
  const saveLabel = capabilities.saveLabel ?? "保存机会";

  const handleViewEvidence = () => {
    if (capabilities.onViewEvidence) {
      capabilities.onViewEvidence();
      return;
    }
    setEvidenceOpen((v) => !v);
  };

  // 访客展开式演示依据：仅当没有 evidenceHref 且卡片携带可展开内容时可用
  const expandableEvidence =
    !capabilities.evidenceHref &&
    ((vm.dimensions?.length ?? 0) > 0 || vm.officialUrl !== null);

  // evidenceHref 安全：官方外链走 safeOfficialLink（拒 example 虚构域）；
  // 站内详情页只允许单斜杠相对路径（拒绝 // 协议相对 URL，防开放重定向）
  const safeEvidenceHref = capabilities.evidenceHref
    ? (safeOfficialLink(capabilities.evidenceHref) ??
      (capabilities.evidenceHref.startsWith("/") &&
      !capabilities.evidenceHref.startsWith("//")
        ? capabilities.evidenceHref
        : null))
    : null;

  return (
    <article
      data-testid={`opportunity-card-${vm.id}`}
      data-variant={variant}
      className={cn(
        "rounded-xl border bg-surface",
        isPriority
          ? "border-brand ring-1 ring-brand-soft"
          : "border-line",
      )}
    >
      <div className="p-4">
        <div className="lg:grid lg:grid-cols-12 lg:gap-4">
          {/* 第 1 层：真实/演示标识 + 截止紧迫度（跨满宽） */}
          <div className="lg:col-span-12">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-testid="dataset-tag">
                {vm.dataset === "demo" ? (
                  <span className="inline-flex h-6 items-center rounded bg-canvas px-2 text-xs font-medium text-ink-muted ring-1 ring-line">
                    {vm.reviewLabel}
                  </span>
                ) : (
                  <span className="inline-flex h-6 items-center rounded bg-warn-soft px-2 text-xs font-medium text-warn">
                    {vm.reviewLabel}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  vm.deadlineClosed ? "text-ink-muted" : "text-ink",
                )}
                data-testid="deadline-text"
              >
                {vm.deadlineText}
              </span>
            </div>
          </div>

          {/* 左区：岗位事实（第 2-4 层）—— 桌面 7 栏 */}
          <div className="mt-3 space-y-2 lg:col-span-7 lg:mt-0">
            {/* 第 2 层：岗位或学校名称 */}
            {vm.titleHref ? (
              <Link
                href={vm.titleHref}
                data-testid="opportunity-title"
                className="block min-w-0 rounded text-sm font-semibold text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span className="break-words">{vm.title}</span>
              </Link>
            ) : (
              <h3
                data-testid="opportunity-title"
                className="text-sm font-semibold text-ink"
              >
                <span className="break-words">{vm.title}</span>
              </h3>
            )}

            {/* 第 3 层：地点 · 任教学校 + 地图入口（地点明确时才显示入口；
                地点文字始终保留，同一卡片只出现一次） */}
            <p
              className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted"
              data-testid="location-row"
            >
              <span>
                {vm.locationText}
                {vm.schoolText ? (
                  <>
                    {" · "}
                    <span data-testid="school-placement">{vm.schoolText}</span>
                  </>
                ) : null}
              </span>
              {vm.mapEntry && (
                <a
                  href={vm.mapEntry.url}
                  {...MAP_LINK_PROPS}
                  className="font-medium text-brand hover:text-brand-strong"
                  data-testid="map-link"
                >
                  {MAP_LINK_LABEL}
                </a>
              )}
            </p>

            {/* 第 4 层：用工形式 / 学段学科 / 招聘人数 */}
            <p className="text-xs text-ink-muted" data-testid="job-facts">
              {vm.employmentNatureText} · {vm.stageSubjectText} · 招{" "}
              {vm.headcount} 人
            </p>
          </div>

          {/* 右区：资格判断（第 5-6 层）—— 桌面 5 栏 */}
          <div className="mt-3 space-y-2 lg:col-span-5 lg:mt-0">
            {/* 第 5 层：资格判断摘要 */}
            <div data-testid="decision-summary">
              {isConsult ? (
                <div data-testid="consult-hint">
                  <p className="text-sm font-medium text-warn">
                    建议向招聘单位确认
                  </p>
                  {vm.consultQuestion && (
                    <p className="mt-1 text-xs leading-5 text-ink-muted">
                      {vm.consultQuestion}
                    </p>
                  )}
                </div>
              ) : (
                <p
                  className="text-xs text-ink-muted"
                  data-testid="conditions-summary"
                >
                  已通过 {vm.passedCount} 项条件
                  {vm.pendingRisk ? `，待确认：${vm.pendingRisk}` : ""}
                </p>
              )}
            </div>

            {/* 状态标签：留档区闸门态 / 偏好范围外安静态 / 四档匹配 */}
            <div className="flex items-center gap-2">
              {vm.closedGate ? (
                <GateTag code={vm.closedGate.code} />
              ) : isOutOfScope ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-muted text-[10px] font-bold text-white"
                  >
                    ◌
                  </span>
                  {vm.natureOutOfPreference ? "用工形式偏好外" : "偏好范围外"}
                </span>
              ) : (
                <MatchStatusTag status={vm.status} />
              )}
            </div>

            {/* 第 6 层：一个关键风险或待补信息 */}
            {vm.summary && (
              <p
                className={cn(
                  "text-sm leading-6",
                  vm.closedGate ? "font-medium text-danger" : "text-ink-muted",
                )}
                data-testid="summary-text"
              >
                {vm.summary}
              </p>
            )}
            {vm.natureOutOfPreference && (
              <p className="text-xs leading-5 text-ink-muted">
                只是用工形式偏好筛选，不代表资格不符合；调整偏好后会重新判断。
              </p>
            )}
          </div>

          {/* 第 7 层：查看官方依据 + 保存机会（跨满宽，两按钮同高同圆角同基线；
              移动端整宽纵向，桌面端并排） */}
          <div className="mt-3 lg:col-span-12 lg:mt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              {safeEvidenceHref ? (
                <Link
                  href={safeEvidenceHref}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  data-testid="view-evidence-button"
                >
                  {evidenceLabel}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleViewEvidence}
                  aria-expanded={evidenceOpen}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  data-testid="view-evidence-button"
                >
                  {evidenceLabel}
                </button>
              )}
              {capabilities.canSave && (
                <button
                  type="button"
                  onClick={capabilities.onSave}
                  disabled={capabilities.saveBusy}
                  aria-busy={capabilities.saveBusy || undefined}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45"
                  data-testid="save-button"
                >
                  {capabilities.saveBusy ? "处理中…" : saveLabel}
                </button>
              )}
            </div>
          </div>
        </div>

        {afterActions}
      </div>

      {/* 访客演示依据展开面板：地图只允许出现在第 3 层地点行，绝不进入此面板 */}
      {evidenceOpen && expandableEvidence && (
        <div
          className="border-t border-line px-4 py-3"
          data-testid="evidence-panel"
        >
          {vm.dimensions && vm.dimensions.length > 0 && (
            <ul className="space-y-2">
              {vm.dimensions.map((d) => (
                <li key={d.label} className="text-xs leading-5">
                  <span className="font-medium text-ink">{d.label}：</span>
                  <span className="text-ink-muted">{d.reason}</span>
                  {d.officialRequirement && (
                    <span className="block pl-3 text-ink-muted/80">
                      公告原文：{d.officialRequirement}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {vm.officialUrl && (
            <a
              href={vm.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center text-xs font-medium text-brand hover:text-brand-strong"
            >
              查看官方公告原文 ↗
            </a>
          )}
          <p className="mt-2 text-[11px] leading-4 text-ink-muted">
            演示示例仅用于体验判断方式，不代表真实招聘。
          </p>
        </div>
      )}

      {expandedExtra}
    </article>
  );
}
