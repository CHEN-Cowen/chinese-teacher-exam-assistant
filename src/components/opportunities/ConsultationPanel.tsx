"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type {
  ConsultationTemplateDTO,
  ContactInfoDTO,
  DimensionDTO,
  EvidenceAnchorDTO,
} from "@/lib/opportunities/api-types";
import { safeOfficialLink } from "@/lib/links/official";
import {
  CONSULTATION_OUTCOME_LABELS,
  CONSULTATION_OUTCOMES,
  encodeConsultationAnswer,
  parseConsultationAnswer,
  type ConsultationOutcome,
} from "@/lib/opportunities/consultation-answer";
import { cn } from "@/lib/utils";

interface ConsultationPanelProps {
  templates: ConsultationTemplateDTO[];
  contact: ContactInfoDTO;
  /** 对应的 MANUAL_REVIEW 维度（按 dimension 字段与模板 dimensionKey 关联），提供原因/原文/证据 */
  dimensions: DimensionDTO[];
  /** 当前 follow 已记录的咨询结论：{ dimensionKey: note（信封 JSON 或历史纯文本） } */
  notes: Record<string, string> | null;
  busy: boolean;
  onSaveNote: (dimensionKey: string, note: string) => void;
  /** 复制问题成功后回调埋点（edited=是否改过模板原文；绝不回传正文） */
  onCopied?: (dimensionKey: string, edited: boolean) => void;
}

interface CopyFeedback {
  scope: string;
  ok: boolean;
  text: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO → 「YYYY-MM-DD HH:mm」；坏值原样截短返回，不抛错 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** 从证据锚点拼出可展示的位置行；任一字段缺失不编造 */
function evidenceLocationLines(evidence: EvidenceAnchorDTO): string[] {
  const lines: string[] = [];
  const locator = evidence.locator;
  if (locator.anchor) lines.push(locator.anchor);
  if (locator.fileName) {
    const position = [
      locator.page ? `第${locator.page}页` : null,
      locator.sheet ? `工作表「${locator.sheet}」` : null,
      locator.cell ? `单元格 ${locator.cell}` : null,
    ]
      .filter(Boolean)
      .join("，");
    lines.push(position ? `${locator.fileName}（${position}）` : locator.fileName);
  }
  return lines;
}

/**
 * 官方联系信息与咨询面板（v7.2 FR-3 增强）。
 * - 为什么需要确认（reason）+ 公告原文/证据锚点/核对时间；
 * - 咨询问题可在本地编辑后复制；复制失败有可见提示；
 * - 个人答复四态信封存 consultationNotes，仅当前用户可见、不参与匹配、
 *   不改公共规则、不影响其他用户；
 * - 不使用 tel:/mailto:，不自动拨号或发送。
 */
export function ConsultationPanel({
  templates,
  contact,
  dimensions,
  notes,
  busy,
  onSaveNote,
  onCopied,
}: ConsultationPanelProps) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  /** 可编辑咨询问题草稿（本地，不持久化；初值=模板原文） */
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  /** 自由文本补充草稿（与已存答复分开管理，失焦保存） */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  /** 复制反馈的自动清除计时器；卸载时必须清理，避免 teardown 后 setState */
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  const dimensionByKey = new Map<string, DimensionDTO>(
    dimensions.map((d) => [d.dimension, d]),
  );
  const officialHref = safeOfficialLink(contact.officialUrl);
  const contactLines = [contact.publisher, contact.contactInfo, contact.officialUrl].filter(
    Boolean,
  ) as string[];
  const contactText = contactLines.join("\n");

  const flashFeedback = (scope: string, ok: boolean) => {
    setCopyFeedback({
      scope,
      ok,
      text: ok ? "已复制" : "复制失败，请手动选择文本",
    });
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setCopyFeedback((current) => (current?.scope === scope ? null : current));
    }, 2000);
  };

  const copyText = async (scope: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      flashFeedback(scope, true);
      return true;
    } catch {
      flashFeedback(scope, false);
      return false;
    }
  };

  const handleCopyQuestion = async (template: ConsultationTemplateDTO) => {
    const draft = questionDrafts[template.dimensionKey] ?? template.question;
    const ok = await copyText(`question:${template.dimensionKey}`, draft);
    if (ok) onCopied?.(template.dimensionKey, draft !== template.question);
  };

  const questionFor = (template: ConsultationTemplateDTO) =>
    questionDrafts[template.dimensionKey] ?? template.question;

  const noteDraftFor = (key: string, raw: string | undefined) =>
    Object.prototype.hasOwnProperty.call(noteDrafts, key) ? noteDrafts[key] : (raw ?? "");

  /** 选四态：自由文本与时间一起进信封；失败由调用方统一报错，不乐观更新 */
  const chooseOutcome = (template: ConsultationTemplateDTO, outcome: ConsultationOutcome) => {
    const key = template.dimensionKey;
    const existing = parseConsultationAnswer(notes?.[key]);
    const note = (noteDrafts[key] ?? existing.note ?? "").trim();
    onSaveNote(
      key,
      encodeConsultationAnswer({ outcome, note, at: new Date().toISOString() }),
    );
  };

  /** 自由文本失焦：已有结构化答复则随信封重存；历史纯文本路径保持纯文本 */
  const persistFreeNote = (template: ConsultationTemplateDTO) => {
    const key = template.dimensionKey;
    const value = (noteDrafts[key] ?? "").trim();
    const existing = parseConsultationAnswer(notes?.[key]);
    if (existing.outcome) {
      if (value !== existing.note) {
        onSaveNote(
          key,
          encodeConsultationAnswer({
            outcome: existing.outcome,
            note: value,
            at: new Date().toISOString(),
          }),
        );
      }
    } else if (value !== (notes?.[key] ?? "")) {
      onSaveNote(key, value);
    }
  };

  return (
    <div className="space-y-4">
      {/* 官方联系方式：只展示与复制，不用 tel:/mailto:，不自动拨号或发送 */}
      <div className="rounded-lg bg-canvas p-3">
        <p className="text-xs font-semibold text-ink">官方联系信息</p>
        <p className="mt-1 text-sm text-ink-muted">{contact.publisher}</p>
        {contact.contactInfo ? (
          <p className="mt-0.5 text-sm text-ink-muted">{contact.contactInfo}</p>
        ) : (
          <p className="mt-0.5 text-xs text-ink-muted">
            公告未提供联系电话/邮箱，联系方式请见公告原文，不要轻信非官方渠道。
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {officialHref ? (
            <a
              href={officialHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand underline"
            >
              打开官方公告原文
            </a>
          ) : (
            <span className="text-xs text-warn">演示数据，请勿据此联系或报名。</span>
          )}
          {contactLines.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void copyText("contact", contactText)}
              data-testid="copy-contact"
            >
              复制联系方式
            </Button>
          )}
          {copyFeedback?.scope === "contact" && (
            <span
              role="status"
              data-testid="copy-contact-feedback"
              className={cn(
                "text-xs",
                copyFeedback.ok ? "text-emerald-700" : "text-danger",
              )}
            >
              {copyFeedback.text}
            </span>
          )}
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          当前没有需要向招聘单位确认的歧义项。
        </p>
      ) : (
        <ul className="space-y-4">
          {templates.map((template) => {
            const key = template.dimensionKey;
            const dimension = dimensionByKey.get(key);
            const savedAnswer = parseConsultationAnswer(notes?.[key]);
            const evidence = dimension?.evidence;
            const locationLines = evidence ? evidenceLocationLines(evidence) : [];
            const feedback =
              copyFeedback?.scope === `question:${key}` ? copyFeedback : null;
            return (
              <li
                key={key}
                data-testid={`consultation-card-${key}`}
                className="rounded-lg border border-line p-3 sm:p-4"
              >
                <p className="text-sm font-medium text-ink">
                  关于「{template.dimensionLabel}」
                </p>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {/* 左栏：为什么需要确认 + 公告原文与证据 */}
                  <div className="space-y-3">
                    {dimension?.reason ? (
                      <div className="rounded-md bg-warn-soft p-2.5">
                        <p className="text-xs font-semibold text-amber-900">
                          为什么需要你向官方确认
                        </p>
                        <p className="mt-1 text-xs leading-5 text-amber-900">
                          {dimension.reason}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted">
                        公告在这项条件上的表述需要以招聘单位解释为准。
                      </p>
                    )}

                    {dimension?.requirementDescription ? (
                      <figure>
                        <figcaption className="text-xs font-medium text-ink-muted">
                          公告原文
                        </figcaption>
                        <blockquote className="mt-1 rounded-md border border-line bg-canvas p-2.5 text-xs leading-5 text-ink">
                          {dimension.requirementDescription}
                        </blockquote>
                      </figure>
                    ) : null}

                    {evidence && (locationLines.length > 0 || evidence.excerpt || evidence.locator.excerpt) ? (
                      <div className="space-y-1 text-xs leading-5 text-ink-muted">
                        <p className="font-medium text-ink-muted">原文位置与摘录</p>
                        {evidence.locator.url ? (
                          <a
                            href={safeOfficialLink(evidence.locator.url) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block break-all text-brand underline"
                          >
                            {evidence.locator.url}
                          </a>
                        ) : null}
                        {locationLines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                        {evidence.locator.excerpt ? (
                          <p className="rounded bg-canvas p-2 text-ink">{evidence.locator.excerpt}</p>
                        ) : null}
                        {evidence.excerpt ? (
                          <p className="rounded bg-canvas p-2 text-ink">{evidence.excerpt}</p>
                        ) : null}
                        <p>核对时间：{formatDateTime(evidence.checkedAt)}</p>
                      </div>
                    ) : null}
                  </div>

                  {/* 右栏：可编辑问题 + 复制 + 个人答复四态 */}
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor={`consult-question-${key}`}
                        className="block text-xs font-medium text-ink"
                      >
                        咨询问题（可直接修改后复制发给官方）
                      </label>
                      <Textarea
                        id={`consult-question-${key}`}
                        data-testid={`consult-question-${key}`}
                        className="min-h-[90px]"
                        value={questionFor(template)}
                        onChange={(e) =>
                          setQuestionDrafts((d) => ({ ...d, [key]: e.target.value }))
                        }
                        maxLength={300}
                        disabled={busy}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void handleCopyQuestion(template)}
                          data-testid={`copy-question-${key}`}
                        >
                          复制问题
                        </Button>
                        {feedback && (
                          <span
                            role="status"
                            data-testid={`copy-question-feedback-${key}`}
                            className={cn(
                              "text-xs",
                              feedback.ok ? "text-emerald-700" : "text-danger",
                            )}
                          >
                            {feedback.text}
                          </span>
                        )}
                      </div>
                    </div>

                    <fieldset>
                      <legend className="text-xs font-medium text-ink">
                        我的官方咨询答复
                      </legend>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {CONSULTATION_OUTCOMES.map((outcome) => (
                          <Button
                            key={outcome}
                            size="sm"
                            variant={
                              savedAnswer.outcome === outcome ? "secondary" : "outline"
                            }
                            aria-pressed={savedAnswer.outcome === outcome}
                            disabled={busy}
                            data-testid={`outcome-${key}-${outcome}`}
                            onClick={() => chooseOutcome(template, outcome)}
                          >
                            {CONSULTATION_OUTCOME_LABELS[outcome]}
                          </Button>
                        ))}
                      </div>
                    </fieldset>

                    <Textarea
                      label="补充说明（可选，仅自己可见）"
                      className="min-h-[72px]"
                      value={noteDraftFor(key, savedAnswer.note)}
                      onChange={(e) =>
                        setNoteDrafts((d) => ({ ...d, [key]: e.target.value }))
                      }
                      onBlur={() => persistFreeNote(template)}
                      placeholder="如：电话确认后，对方表示汉语言文学师范专业符合……"
                      maxLength={300}
                      disabled={busy}
                      data-testid={`consult-note-${key}`}
                    />

                    {savedAnswer.outcome ? (
                      <div
                        className="rounded-md bg-canvas p-2.5 text-xs leading-5 text-ink-muted"
                        data-testid={`consult-record-${key}`}
                      >
                        <p className="font-medium text-ink">
                          已记录：{CONSULTATION_OUTCOME_LABELS[savedAnswer.outcome]}
                          {savedAnswer.at ? ` · ${formatDateTime(savedAnswer.at)}` : ""}
                        </p>
                        {savedAnswer.note ? <p className="mt-0.5">{savedAnswer.note}</p> : null}
                      </div>
                    ) : null}

                    <p className="text-[11px] leading-4 text-ink-muted">
                      这是你的个人记录，不会变成所有用户的判断规则，也不会影响其他用户；不替代官方审核结论。
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
