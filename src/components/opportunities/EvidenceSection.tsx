"use client";

import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ia/Layer";
import { dimensionLabel } from "@/lib/ia/labels";
import type { UnitDetailResponse } from "@/lib/opportunities/api-types";
import { safeOfficialLink } from "@/lib/links/official";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  original: "原始公告",
  supplement: "补充公告",
  correction: "更正公告",
};

function EvidenceLink({ url }: { url?: string }) {
  const link = safeOfficialLink(url);
  if (!link) return <span className="text-ink-muted">虚构示例，无可访问的官方原文</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-brand underline underline-offset-2"
    >
      打开官方原文（新窗口）
    </a>
  );
}

/**
 * 详情第三段：官方原文与岗位表位置。
 * 只放「官方事实在哪里」：当前依据版本、官方来源链接、报名时间口径、
 * 岗位表行级锚点与逐项条件原文摘录。核对/复核状态与版本变化在第四段。
 */
export function OfficialSourceSection({
  detail,
}: {
  detail: UnitDetailResponse;
}) {
  const { unit } = detail;
  const evidences = unit.dimensions.filter((d) => d.evidence);
  const source = unit.version.officialSource;
  const isDemo = unit.announcement.dataset === "demo";

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">
          {isDemo ? "示例公告与岗位表位置" : "官方原文与岗位表位置"}
        </h3>
        {isDemo && <p className="mt-1 text-xs font-medium text-warn">以下内容和日期均为虚构演示，不代表官方招聘信息。</p>}
        <p className="mt-0.5 text-xs text-ink-muted">
          当前依据：
          {SOURCE_KIND_LABELS[unit.version.sourceKind] ??
            unit.version.sourceKind}{" "}
          v{unit.version.versionNumber} ·{" "}
          {formatDateTime(unit.version.publishedAt)} 发布 ·{" "}
          {unit.announcement.publisher}
        </p>

        <dl className="mt-3 space-y-2 text-xs text-ink-muted">
          <div>
            <dt className="font-medium text-ink-muted">{isDemo ? "示例来源" : "官方来源"}</dt>
            <dd className="mt-0.5">
              <EvidenceLink url={source.locator.url} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-ink-muted">{isDemo ? "示例报名时间" : "报名时间（公告口径）"}</dt>
            <dd>
              {unit.version.timeline.registrationStart &&
              unit.version.timeline.registrationEnd
                ? `${unit.version.timeline.registrationStart} 至 ${unit.version.timeline.registrationEnd}`
                : "官方尚未公布具体报名时间，以官方后续通知为准"}
            </dd>
          </div>
          {unit.version.timeline.writtenExamDate && (
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-ink-muted">笔试时间</dt>
              <dd>{unit.version.timeline.writtenExamDate}</dd>
            </div>
          )}
          {unit.version.timeline.pendingItems?.map((item) => (
            <div key={item} className="text-ink-muted">
              {isDemo ? "示例待定：" : "待官方明确："}{item}
            </div>
          ))}
        </dl>

        {unit.unit.sourceRow && (
          <div className="mt-3 rounded-lg border border-line bg-canvas p-3">
            <p className="text-xs font-semibold text-ink">
              岗位表位置（行级锚点）
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {unit.unit.sourceRow.locator.anchor ??
                unit.unit.sourceRow.locator.sheet ??
                "官方岗位表附件"}
            </p>
            {unit.unit.sourceRow.excerpt && (
              <p className="mt-1 border-l-2 border-line pl-2 text-xs text-ink-muted">
                “{unit.unit.sourceRow.excerpt}”
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-ink-muted">
              <EvidenceLink url={unit.unit.sourceRow.locator.url} />
            </p>
          </div>
        )}
      </div>

      <Disclosure title="逐项条件的原文证据" count={evidences.length}>
        <ul className="space-y-3">
          {evidences.map((dim) => (
            <li
              key={dim.requirementId}
              className="rounded-lg border border-line p-3"
            >
              <p className="text-xs font-semibold text-ink">
                {dim.dimension === "region"
                  ? "就业地区"
                  : dimensionLabel(dim.dimension)}
                {dim.requirementDescription
                  ? `：${dim.requirementDescription}`
                  : ""}
              </p>
              {dim.evidence?.excerpt && (
                <p className="mt-1 border-l-2 border-line pl-2 text-xs text-ink-muted">
                  “{dim.evidence.excerpt}”
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-ink-muted">
                <EvidenceLink url={dim.evidence?.locator.url} />
              </p>
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

/**
 * 详情第四段：核对时间与变化。
 * 说明「这条依据什么时候核对过、是否人工复核、与上一版差在哪」，
 * 并保留纠错出口与规则版本脚注（结论可复算、变化可追溯）。
 */
export function VerificationSection({
  detail,
  onOpenCorrection,
}: {
  detail: UnitDetailResponse;
  /** D08：可携带预选的问题位置（从逐条件解释行进入时由调用方传入） */
  onOpenCorrection: (fieldPath?: string) => void;
}) {
  const { unit, previousVersions, meta } = detail;
  const source = unit.version.officialSource;
  const isDemo = unit.announcement.dataset === "demo";

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">
            核对时间与变化
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenCorrection()}
          >
            提交纠错
          </Button>
        </div>

        {unit.version.changeNote && (
          <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            本次版本变化：{unit.version.changeNote}
          </p>
        )}

        <dl className="mt-3 space-y-2 text-xs text-ink-muted">
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-ink-muted">{isDemo ? "示例来源" : "官方来源核对"}</dt>
            <dd>
              {isDemo
                ? "虚构演示，未核对真实公告"
                : source.state === "official"
                ? "已与官方公告核对"
                : "待人工核对（不作为正式依据）"}
              ，{isDemo ? "演示基准时间" : "核对时间"} {formatDateTime(source.checkedAt)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-ink-muted">人工复核</dt>
            <dd>
              {isDemo
                ? "不适用（虚构示例）"
                : unit.announcement.reviewStatus === "human_reviewed"
                ? "已人工复核"
                : "AI 初核 · 待人工复核（不作为正式推荐依据）"}
              {unit.announcement.reviewedBy
                ? ` · 复核人 ${unit.announcement.reviewedBy}`
                : ""}
              {unit.announcement.reviewedAt
                ? ` · 复核于 ${formatDateTime(unit.announcement.reviewedAt)}`
                : ""}
            </dd>
          </div>
        </dl>
      </div>

      {previousVersions.length > 0 && (
        <Disclosure title="历史版本" count={previousVersions.length}>
          <ul className="space-y-2 text-xs text-ink-muted">
            {previousVersions.map((v) => (
              <li key={v.id} className="rounded-lg bg-canvas p-2.5">
                <p>
                  {SOURCE_KIND_LABELS[v.sourceKind] ?? v.sourceKind} v
                  {v.versionNumber} · {formatDateTime(v.publishedAt)}
                  {v.supersededAt && (
                    <span className="ml-2 text-ink-muted">
                      已于 {formatDateTime(v.supersededAt)} 被新版本取代
                    </span>
                  )}
                </p>
                {v.changeNote && (
                  <p className="mt-1 text-ink-muted">说明：{v.changeNote}</p>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
        本结论由规则版本 {meta.ruleVersion}、专业别名表{" "}
        {meta.majorAliasVersion}、公告目录 {meta.catalogVersion} 与真实监测台账{" "}
        {meta.realCatalogVersion} 于 {formatDateTime(meta.evaluatedAt)} 计算；
        公告更新或你修改报考信息后会重新判断。最终资格以招聘单位审核为准。
      </p>
    </section>
  );
}
