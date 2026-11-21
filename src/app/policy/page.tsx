"use client";

/**
 * W5：地区/年份明确的政策检索入口。
 *
 * - 先选地区与年份，再问问题；全国使用「全国」；
 * - 覆盖面板区分「本地区有材料」「仅有全国/城市材料」「暂无覆盖」与查询故障；
 * - 公告与政策同时命中时并列展示，提示核实，不自动判定覆盖关系；
 * - 演示环境不开放问答，不伪造答案。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useCurrentUser } from "@/lib/auth";
import { SUBJECT_OPTIONS } from "@/lib/subjects/catalog";
import {
  POLICY_REGIONS,
  policyApi,
  type PolicyAnswerDTO,
  type PolicyCoverageDTO,
} from "@/lib/knowledge/policy-api";
import type { QaCitationDTO } from "@/lib/knowledge/qa-api";
import { safeOfficialLink } from "@/lib/links/official";

const MAX_QUESTION_CHARS = 200;
const YEARS = [2026, 2025, 2024, 2023];

const STATUS_LABELS: Record<PolicyAnswerDTO["status"], string> = {
  answered: "依据已发布材料回答",
  unverified: "未核对到原文，请以官方文本为准",
  refused: "材料不足，暂不能回答",
  no_coverage: "该范围暂无已发布材料",
  error: "回答失败",
};

const VALIDITY_LABELS: Record<string, string> = {
  effective: "有效期内",
  expired: "已失效（未作为依据）",
  not_yet_effective: "尚未生效",
  unknown: "有效期未标注",
};

function validityVariant(
  validity: string | undefined,
): "success" | "warning" | "muted" | "danger" {
  if (validity === "effective") return "success";
  if (validity === "expired") return "danger";
  if (validity === "not_yet_effective") return "warning";
  return "muted";
}

function coverageLabel(status: PolicyCoverageDTO["status"]): string {
  if (status === "covered") return "本地区当年有可检索材料";
  if (status === "partial") return "仅有全国性或其他地区材料";
  return "本地区当年暂无可检索材料";
}

function coverageVariant(
  status: PolicyCoverageDTO["status"],
): "success" | "warning" | "muted" {
  if (status === "covered") return "success";
  if (status === "partial") return "warning";
  return "muted";
}

function citationHref(citation: QaCitationDTO): string | null {
  return citation.officialUrl ? safeOfficialLink(citation.officialUrl) : null;
}

export default function PolicyPage() {
  const { status } = useCurrentUser();
  const signedIn = status === "authenticated";
  const [regionCode, setRegionCode] = useState("000000");
  const [year, setYear] = useState(2026);
  const [subject, setSubject] = useState("");
  const [audience, setAudience] = useState("");
  const [question, setQuestion] = useState("");
  const [coverage, setCoverage] = useState<PolicyCoverageDTO | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PolicyAnswerDTO | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    policyApi
      .coverage({ regionCode, year, subjects: subject ? [subject] : undefined })
      .then((result) => {
        if (cancelled) return;
        setCoverage(result);
        setCoverageError(null);
      })
      .catch((error: Error & { code?: string }) => {
        if (cancelled) return;
        setCoverage(null);
        setCoverageError(
          error.code === "coverage_unavailable"
            ? "覆盖查询暂不可用，这不是“无覆盖”，请稍后再试。"
            : error.message,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [regionCode, year, subject]);

  async function ask() {
    if (!signedIn) {
      setAskError("请先登录后再提问。");
      return;
    }
    setAsking(true);
    setAskError(null);
    try {
      const result = await policyApi.ask({
        question: question.trim(),
        regionCode,
        year,
        ...(subject ? { applicableSubjects: [subject] } : {}),
        ...(audience.trim() ? { applicableAudience: audience.trim() } : {}),
      });
      setAnswer(result);
      setCoverage(result.coverage);
    } catch (error) {
      const err = error as Error & { code?: string; status?: number };
      if (err.code === "coverage_unavailable") {
        setAskError("覆盖查询暂不可用，不能判断该地区是否有材料，请稍后再试。");
      } else if (err.code === "retrieval_failed") {
        setAskError("检索暂不可用，不能确认问题是否有材料依据，请稍后再试。");
      } else if (err.status === 503) {
        setAskError("问答服务暂不可用，请稍后再试或联系管理员。");
      } else {
        setAskError(err.message);
      }
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="mx-auto max-w-[960px] px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">政策检索</h1>
        <p className="mt-1 text-sm text-ink-muted">
          先选择地区和年份，再检索该范围的官方政策与招聘公告。系统只使用已发布材料，不做跨地区套用。
        </p>
      </header>

      <Card>
        <CardHeader title="检索范围" description="地区与年份必须明确；全国选择只统计全国适用材料" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="地区"
            value={regionCode}
            onChange={(event) => setRegionCode(event.target.value)}
            options={POLICY_REGIONS.map((item) => ({ value: item.code, label: item.label }))}
          />
          <Select
            label="适用年份"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
            options={YEARS.map((item) => ({ value: String(item), label: `${item} 年` }))}
          />
          <Select
            label="学科（可选）"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            options={[
              { value: "", label: "不限学科" },
              ...SUBJECT_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
            ]}
          />
        </div>
        <Input
          label="适用对象（可选）"
          value={audience}
          maxLength={50}
          onChange={(event) => setAudience(event.target.value)}
          placeholder="如：教师公开招聘、中小学教师"
          hint="只用于收窄材料，不替代官方解释。"
        />
      </Card>

      <Card className="mt-4">
        <CardHeader title="覆盖情况" description="只反映已发布且索引可检索的实测材料" />
        {coverageError ? (
          <p className="text-sm text-danger">{coverageError}</p>
        ) : !coverage ? (
          <p className="text-sm text-ink-muted">正在查询覆盖…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={coverageVariant(coverage.status)}>
                {coverageLabel(coverage.status)}
              </Badge>
              <span className="text-sm text-ink-muted">
                {coverage.regionLabel} · {coverage.year} 年
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-ink-muted">本地区材料</dt>
                <dd className="font-medium text-ink">
                  {coverage.exact.documents} 份（可检索 {coverage.exact.queryable}）
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">全国性政策</dt>
                <dd className="font-medium text-ink">
                  {coverage.national.documents} 份（可检索 {coverage.national.queryable}）
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">已发布待索引</dt>
                <dd className="font-medium text-ink">
                  {coverage.exact.publishedNotIndexed + coverage.national.publishedNotIndexed} 份
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">已失效材料</dt>
                <dd className="font-medium text-ink">
                  {coverage.exact.expired + coverage.national.expired} 份
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">学科筛除</dt>
                <dd className="font-medium text-ink">{coverage.subjectExcluded} 份</dd>
              </div>
            </dl>
            {coverage.sources.length > 0 && (
              <p className="text-sm text-ink-muted">
                来源：{coverage.sources.map((item) => `${item.publisher}（${item.documents}）`).join("、")}
              </p>
            )}
            {coverage.descendants.length > 0 && (
              <p className="text-sm text-ink-muted">
                同省其他城市材料：
                {coverage.descendants
                  .map((item) => `${item.regionLabel} ${item.documents} 份`)
                  .join("、")}
                （不计为全省覆盖）
              </p>
            )}
            {coverage.years.length > 1 && (
              <p className="text-sm text-ink-muted">
                其他年份：{coverage.years
                  .filter((item) => item.year !== coverage.year && item.year !== null)
                  .map((item) => `${item.year} 年 ${item.documents} 份`)
                  .join("、")}
              </p>
            )}
            <p className="text-[13px] text-ink-muted">{coverage.note}</p>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="提问" description="回答只依据所选范围内的已发布材料" />
        {!signedIn && (
          <p className="mb-3 text-sm text-ink-muted">
            政策问答需要登录；<Link href="/login" className="text-brand hover:underline">去登录</Link>。
          </p>
        )}
        <Textarea
          label="问题"
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          rows={3}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：2026 年南京市教师招聘对语文教师的学历和教师资格有什么要求？"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-muted">最多 {MAX_QUESTION_CHARS} 字；不预测、不推断未写明的条件。</p>
          <Button
            type="button"
            onClick={() => void ask()}
            disabled={!signedIn || asking || question.trim().length === 0}
          >
            {asking ? "检索中…" : "提问"}
          </Button>
        </div>
        {askError && <p className="mt-3 text-sm text-danger">{askError}</p>}
      </Card>

      {answer && (
        <Card className="mt-4">
          <CardHeader title="回答" description="引用编号对应下方原文片段" />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge
              variant={
                answer.status === "answered"
                  ? "success"
                  : answer.status === "unverified"
                    ? "warning"
                    : answer.status === "error"
                      ? "danger"
                      : "muted"
              }
            >
              {STATUS_LABELS[answer.status] ?? answer.status}
            </Badge>
            <span className="text-sm text-ink-muted">
              {answer.scope.regionLabel} · {answer.scope.year} 年
              {answer.scope.applicableSubjects.length
                ? ` · ${answer.scope.applicableSubjects.join("、")}`
                : ""}
            </span>
            {answer.mode === "mock" && <Badge variant="muted">演示回答</Badge>}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-ink">{answer.answer}</p>

          {answer.conflicts.length > 0 && (
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm font-semibold text-ink">公告与政策同时命中</p>
              <p className="mt-1 text-[13px] text-ink-muted">{answer.conflicts[0]!.reason}</p>
              <p className="mt-1 text-[13px] text-ink-muted">{answer.conflicts[0]!.suggestion}</p>
              {answer.conflicts.map((conflict) => (
                <div key={`${conflict.announcement.documentId}-${conflict.policy.documentId}`} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-surface p-2">
                    <Badge variant="muted">公告</Badge>
                    <p className="mt-1 text-sm font-medium text-ink">{conflict.announcement.documentTitle}</p>
                    <p className="mt-1 text-[13px] text-ink-muted">{conflict.announcement.snippet}</p>
                  </div>
                  <div className="rounded-md border border-line bg-surface p-2">
                    <Badge variant="muted">政策</Badge>
                    <p className="mt-1 text-sm font-medium text-ink">{conflict.policy.documentTitle}</p>
                    <p className="mt-1 text-[13px] text-ink-muted">{conflict.policy.snippet}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {answer.citations.length > 0 && (
            <ul className="mt-4 space-y-3">
              {answer.citations.map((citation) => (
                <li key={citation.chunkId} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">[{citation.index}]</span>
                    <span className="text-sm font-medium text-ink">{citation.documentTitle}</span>
                    {citation.documentType && (
                      <Badge variant="muted">
                        {citation.documentType === "policy" ? "政策" : "公告"}
                      </Badge>
                    )}
                    {citation.validity && (
                      <Badge variant={validityVariant(citation.validity)}>
                        {VALIDITY_LABELS[citation.validity] ?? citation.validity}
                      </Badge>
                    )}
                  </div>
                  {(citation.effectiveFrom || citation.effectiveTo) && (
                    <p className="mt-1 text-[13px] text-ink-muted">
                      有效期：
                      {citation.effectiveFrom ? citation.effectiveFrom.slice(0, 10) : "未标注"}
                      {" 至 "}
                      {citation.effectiveTo ? citation.effectiveTo.slice(0, 10) : "未标注"}
                    </p>
                  )}
                  {(citation.applicableAudience || citation.applicableSubjects?.length) && (
                    <p className="mt-1 text-[13px] text-ink-muted">
                      适用范围：
                      {citation.applicableAudience ?? "未标注对象"}
                      {citation.applicableSubjects?.length
                        ? `；学科：${citation.applicableSubjects.join("、")}`
                        : ""}
                    </p>
                  )}
                  {citation.locator.anchor && (
                    <p className="mt-1 text-[13px] text-ink-muted">位置：{citation.locator.anchor}</p>
                  )}
                  <p className="mt-1 text-[13px] text-ink-muted">{citation.snippet}</p>
                  {citationHref(citation) && (
                    <a
                      href={citationHref(citation)!}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[13px] text-brand hover:underline"
                    >
                      查看官方原文
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </main>
  );
}
