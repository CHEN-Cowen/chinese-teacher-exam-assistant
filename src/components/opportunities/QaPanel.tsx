"use client";

/**
 * W3：公告级问答面板。
 *
 * 只依据已发布的官方材料回答；回答中的 [n] 对应下方原文片段。
 * 没有证据时展示拒答，未核对时显著提示；不做“看起来很确定”的包装。
 * 反馈只影响质量统计，不改变官方事实或匹配结论。
 */
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { safeOfficialLink } from "@/lib/links/official";
import {
  qaApi,
  QaRequestError,
  type QaAnswerDTO,
  type QaCitationDTO,
} from "@/lib/knowledge/qa-api";

const MAX_QUESTION_CHARS = 200;

const STATUS_LABELS: Record<QaAnswerDTO["status"], string> = {
  answered: "依据已发布材料回答",
  unverified: "未核对到原文，请以公告为准",
  refused: "材料不足，暂不能回答",
  error: "回答失败",
};

const STATUS_VARIANTS: Record<
  QaAnswerDTO["status"],
  "success" | "warning" | "muted" | "danger"
> = {
  answered: "success",
  unverified: "warning",
  refused: "muted",
  error: "danger",
};

type FeedbackType = "helpful" | "not_helpful" | "incorrect";

const FEEDBACK_BUTTONS: Array<{ type: FeedbackType; label: string }> = [
  { type: "helpful", label: "有帮助" },
  { type: "not_helpful", label: "没帮助" },
  { type: "incorrect", label: "内容不准确" },
];

function locatorLine(citation: QaCitationDTO): string | null {
  const { locator } = citation;
  const parts: string[] = [];
  if (locator.anchor) parts.push(locator.anchor);
  if (locator.fileName) {
    const position = [
      locator.page ? `第${locator.page}页` : null,
      locator.sheet ? `工作表「${locator.sheet}」` : null,
      locator.cell ? `单元格 ${locator.cell}` : null,
    ]
      .filter(Boolean)
      .join("，");
    parts.push(position ? `${locator.fileName}（${position}）` : locator.fileName);
  }
  return parts.length > 0 ? parts.join("｜") : null;
}

export function QaPanel({
  unitId,
  announcementId,
}: {
  unitId: string;
  announcementId: string;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<QaAnswerDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<FeedbackType | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  if (!qaApi.supported) return null;

  const submit = async () => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    setFeedbackSent(null);
    try {
      const result = await qaApi.ask({ question: text, unitId, announcementId });
      setAnswer(result);
    } catch (e) {
      setAnswer(null);
      setError(
        e instanceof QaRequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : "问答请求失败",
      );
    } finally {
      setAsking(false);
    }
  };

  const sendFeedback = async (type: FeedbackType) => {
    if (!answer || feedbackBusy || feedbackSent) return;
    setFeedbackBusy(true);
    try {
      await qaApi.feedback(answer.id, type);
      setFeedbackSent(type);
    } catch {
      setError("反馈提交失败，请稍后再试");
    } finally {
      setFeedbackBusy(false);
    }
  };

  return (
    <section id="qa" className="scroll-mt-20 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink">问这份公告</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          只基于已发布的官方材料回答，并给出原文位置；材料不足时直接说不知道。
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <Textarea
          label="你想确认什么"
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          placeholder="例如：这个岗位要求教师资格证的学段是？"
          disabled={asking}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">
            {question.length}/{MAX_QUESTION_CHARS}
          </span>
          <Button
            size="sm"
            disabled={asking || question.trim().length === 0}
            onClick={() => void submit()}
            data-testid="qa-submit"
          >
            {asking ? "检索中…" : "提问"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        {answer && (
          <div className="mt-4 space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANTS[answer.status]}>
                {STATUS_LABELS[answer.status]}
              </Badge>
              {answer.needsOfficialConfirmation && answer.status === "answered" && (
                <span className="text-xs text-warn">部分引用未核对，请以公告原文为准</span>
              )}
            </div>

            <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
              {answer.answer}
            </p>

            {answer.citations.length > 0 && (
              <ol className="space-y-2">
                {answer.citations.map((citation) => {
                  const href = safeOfficialLink(citation.officialUrl);
                  const location = locatorLine(citation);
                  return (
                    <li
                      key={citation.chunkId}
                      className="rounded-lg border border-line bg-canvas p-2.5 text-xs leading-5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-ink">
                          [{citation.index}] {citation.documentTitle}
                        </p>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-brand underline"
                          >
                            官方原文
                          </a>
                        )}
                      </div>
                      {location && <p className="mt-1 text-ink-muted">位置：{location}</p>}
                      <p className="mt-1 text-ink-muted">{citation.snippet}</p>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {FEEDBACK_BUTTONS.map((item) => (
                <Button
                  key={item.type}
                  size="sm"
                  variant={feedbackSent === item.type ? "primary" : "ghost"}
                  disabled={feedbackBusy || feedbackSent !== null}
                  onClick={() => void sendFeedback(item.type)}
                >
                  {item.label}
                </Button>
              ))}
              {feedbackSent && <span className="text-xs text-ink-muted">已记录反馈，谢谢</span>}
            </div>

            <p className="text-xs leading-5 text-ink-muted">
              回答由模型基于已发布材料生成，可能有遗漏；报名条件以官方公告与招聘单位答复为准。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
