"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";
import {
  announcementsPipelineApi,
  type ProjectionStatus,
  type PublishedVersion,
  type Run,
  type SnapshotParsedResponse,
} from "@/lib/announcements-pipeline/api";
import { ReviewWorkbench } from "./review-workbench";
import { ExportSection } from "./export-section";
import { PipelineSummaryCard } from "@/components/admin/PipelineSummaryCard";

// ==================== 状态映射 ====================

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  submitted: { label: "已提交", className: "bg-slate-100 text-slate-600" },
  extracting: { label: "提取中", className: "bg-blue-100 text-blue-700" },
  pending_review: { label: "待审核", className: "bg-amber-100 text-amber-700" },
  approved: { label: "审核通过", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "已驳回", className: "bg-red-100 text-red-700" },
  failed: { label: "提取失败", className: "bg-red-100 text-red-700" },
  published: { label: "已发布", className: "bg-emerald-100 text-emerald-700" },
};

const FIELD_LABELS: Record<string, string> = {
  title: "公告标题",
  registration_time: "报名时间",
  exam_time: "考试时间",
  subjects: "考试科目",
  score: "分值",
  qualification: "资格条件",
  headcount: "招聘人数",
  exam_scope: "考试范围",
  employment_nature: "用工性质",
  education: "学历要求",
  major: "专业要求",
  teacher_cert: "教师资格",
  age: "年龄要求",
};

// ==================== 主页面 ====================

export default function AdminPipelinePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // 提交表单
  const [submitMode, setSubmitMode] = useState<"url" | "text">("url");
  const [publisher, setPublisher] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<
    Array<{ name: string; mimeType: string; base64: string }>
  >([]);
  const [submitting, setSubmitting] = useState(false);

  // 附件上传：读为 base64（M1 材料包），不直接提交二进制（保持 JSON 通路）
  const handleAttachments = (files: FileList | null) => {
    if (!files) return;
    const next: Array<{ name: string; mimeType: string; base64: string }> = [];
    let remaining = files.length;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        next.push({ name: file.name, mimeType: file.type, base64 });
        remaining -= 1;
        if (remaining === 0) {
          setAttachments((prev) => [...prev, ...next]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const refresh = async () => {
    try {
      setError(null);
      const list = await announcementsPipelineApi.listRuns();
      setRuns(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  // 初始加载：内联 fetch，避免在 effect 中直接调用含 setState 的函数
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await announcementsPipelineApi.listRuns();
        if (!cancelled) setRuns(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        publisher: publisher.trim() || "未命名来源",
        officialUrl: submitMode === "url" ? officialUrl.trim() : `text://${Date.now()}`,
        sourceType: submitMode === "url" ? "government" : "manual_text",
        content: submitMode === "url" ? officialUrl.trim() : content,
        mimeType: submitMode === "url" ? "text/plain" : "text/html",
        attachments: attachments.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          base64: a.base64,
        })),
      };
      // URL 模式：content 为官方链接，后端用安全抓取器抓取真实正文；
      // 抓取失败后端返回明确错误，前端提示切换「粘贴正文」人工输入。
      await announcementsPipelineApi.submitSource(input);
      setOfficialUrl("");
      setContent("");
      setAttachments([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExtract = async (runId: string) => {
    try {
      await announcementsPipelineApi.runExtraction(runId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败");
    }
  };

  const handleRetry = async (runId: string) => {
    try {
      await announcementsPipelineApi.retryRun(runId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">公告提取与审核流水线</h1>
        <p className="text-sm text-slate-500 mt-1">
          提交官方公告 → 机器提取候选 → 人工审核 → 发布不可变版本。高影响字段必须有证据锚点才能通过。
        </p>
      </div>

      {/* 跨阶段汇总（D09 / U10）：来源→快照→解析→提取→发布各阶段真实计数 */}
      <PipelineSummaryCard />

      {/* 提交区 */}
      <Card>
        <p className="text-sm font-semibold text-slate-800 mb-3">提交公告来源</p>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setSubmitMode("url")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm border",
              submitMode === "url"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600"
            )}
          >
            公告链接
          </button>
          <button
            type="button"
            onClick={() => setSubmitMode("text")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm border",
              submitMode === "text"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600"
            )}
          >
            粘贴正文
          </button>
        </div>

        <div className="space-y-3">
          <Input
            label="发布主体（如：杭州市教育局）"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            placeholder="可选，默认未命名来源"
          />
          {submitMode === "url" ? (
            <Input
              label="官方公告链接"
              value={officialUrl}
              onChange={(e) => setOfficialUrl(e.target.value)}
              placeholder="https://www.example.gov.cn/...（提交后真实抓取正文，失败可切换「粘贴正文」人工输入）"
            />
          ) : (
            <>
              <Textarea
                label="公告正文"
                className="min-h-[160px]"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴公告 HTML 或纯文本正文，系统会自动提取报名时间、考试时间、科目、分值、资格条件等字段"
              />
              <div className="space-y-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">岗位附件（可选，如岗位表 xlsx/pdf）</span>
                  <input
                    type="file"
                    multiple
                    accept=".xls,.xlsx,.xlsb,.et,.pdf,.docx"
                    onChange={(e) => handleAttachments(e.target.files)}
                    className="mt-1 block w-full text-sm text-slate-500 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                  />
                </label>
                {attachments.length > 0 && (
                  <ul className="space-y-1">
                    {attachments.map((a) => (
                      <li key={a.name} className="flex items-center justify-between text-xs text-slate-500">
                        <span className="truncate">📎 {a.name}</span>
                        <button
                          type="button"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => setAttachments((prev) => prev.filter((x) => x.name !== a.name))}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <Button onClick={handleSubmit} disabled={submitting || (submitMode === "url" ? !officialUrl : !content)}>
            {submitting ? "提交中..." : "提交并创建提取任务"}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* 任务列表 */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-800">提取任务列表</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            刷新
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">加载中...</p>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<span className="text-4xl">📭</span>}
            title="还没有提取任务"
            description="在上方提交公告链接或正文，系统会创建提取任务"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">提交时间</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const st = STATUS_LABELS[run.status] ?? { label: run.status, className: "bg-slate-100" };
                  return (
                    <tr key={run.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-800 truncate max-w-[200px]">
                          {run.snapshot?.source?.publisher ?? "未知来源"}
                        </p>
                        <p className="text-xs text-slate-400 truncate max-w-[200px]">
                          {run.snapshot?.officialUrl ?? run.snapshot?.contentHash?.slice(0, 12)}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium", st.className)}>
                          {st.label}
                        </span>
                        {run.errorMessage && (
                          <p className="text-xs text-red-500 mt-1 max-w-[180px] truncate">
                            {run.errorMessage}
                          </p>
                        )}
                        {run.manualExtraction?.files && run.manualExtraction.files.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {run.manualExtraction.files.map((f) => (
                              <p
                                key={`${f.kind}-${f.snapshotId}`}
                                className={cn(
                                  "text-xs truncate max-w-[180px]",
                                  f.readStatus === "ok" ? "text-slate-400" : "text-amber-600"
                                )}
                              >
                                {f.kind === "body" ? "正文" : "附件"} · {f.name} ·{" "}
                                {f.readStatus === "ok" ? "已读取" : f.reason ?? f.readStatus}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">
                        {formatDateTime(run.createdAt)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(run.status === "submitted" || run.status === "failed") && (
                            <Button size="sm" onClick={() => handleExtract(run.id)}>
                              {run.status === "failed" ? "重新提取" : "开始提取"}
                            </Button>
                          )}
                          {run.status === "failed" && (
                            <Button size="sm" variant="outline" onClick={() => handleRetry(run.id)}>
                              重置任务
                            </Button>
                          )}
                          {run.status === "pending_review" && (
                            <Button size="sm" onClick={() => setSelectedRunId(run.id)}>
                              去审核
                            </Button>
                          )}
                          {run.status === "approved" && (
                            <PublishButton runId={run.id} onPublished={refresh} />
                          )}
                          {run.status === "published" && (
                            <span className="text-xs text-emerald-600">已发布 v{run.publishedVersion?.versionNumber}</span>
                          )}
                          {(run.status === "approved" || run.status === "published") && (
                            <Button size="sm" variant="outline" onClick={() => setSelectedRunId(run.id)}>
                              查看
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 审核面板 */}
      {selectedRunId && (
        <ReviewOverlay onClose={() => setSelectedRunId(null)}>
          <ReviewPanel
            key={selectedRunId}
            runId={selectedRunId}
            onClose={() => setSelectedRunId(null)}
            onDone={() => {
              setSelectedRunId(null);
              refresh();
            }}
          />
        </ReviewOverlay>
      )}

      {/* 已发布版本 */}
      <PublishedVersionsSection runs={runs} />
    </div>
  );
}

// 审核详情必须在当前视口可见，不能被长任务列表推到屏幕之外。
function ReviewOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
        ) ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 p-2 sm:p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="公告审核详情" tabIndex={-1}
        className="mx-auto flex h-full max-w-7xl flex-col rounded-xl bg-slate-50 shadow-xl outline-none">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">公告审核详情</h2>
          <Button size="sm" variant="outline" onClick={onClose}>返回任务列表</Button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

// ==================== 发布按钮 ====================

function PublishButton({ runId, onPublished }: { runId: string; onPublished: () => void }) {
  const [dataset, setDataset] = useState<"demo" | "real">("demo");
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="发布数据集" value={dataset} disabled={publishing}
        className="rounded border border-slate-300 bg-white p-1 text-sm text-slate-900"
        onChange={(event) => setDataset(event.target.value as "demo" | "real")}>
        <option value="demo">演示数据（demo）</option>
        <option value="real">正式数据（real）</option>
      </select>
      <span className="text-xs text-slate-600">{dataset === "real" ? "正式发布需有效人工审核与官方证据" : "演示数据不进入正式机会匹配"}</span>
      <Button
        size="sm"
        onClick={async () => {
          setPublishing(true);
          setErr(null);
          try {
            await announcementsPipelineApi.publish(runId, dataset);
            onPublished();
          } catch (e) {
            setErr(e instanceof Error ? e.message : "发布失败");
          } finally {
            setPublishing(false);
          }
        }}
        disabled={publishing}
      >
        {publishing ? "发布中..." : "发布"}
      </Button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </div>
  );
}

// ==================== 审核面板（WB4：按岗位人工审核工作台） ====================

function ReviewPanel({
  runId,
  onClose,
  onDone,
}: {
  runId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [originalContent, setOriginalContent] = useState("");
  const [parsed, setParsed] = useState<SnapshotParsedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await announcementsPipelineApi.getRun(runId);
        if (cancelled) return;
        setRun(r);
        if (r.snapshot?.id) {
          const [snap, parsedRes] = await Promise.all([
            announcementsPipelineApi.getSnapshotContent(r.snapshot.id),
            announcementsPipelineApi.getSnapshotParsed(r.snapshot.id).catch(() => null),
          ]);
          if (cancelled) return;
          setOriginalContent(snap.content);
          setParsed(parsedRes);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-400">加载审核详情...</p>
      </Card>
    );
  }

  if (error || !run) {
    return (
      <Card>
        <p className="text-sm text-red-600">{error ?? "任务不存在"}</p>
        <Button size="sm" variant="outline" onClick={onClose} className="mt-2">
          关闭
        </Button>
      </Card>
    );
  }

  const parseRun = parsed?.parseRun ?? null;
  const parseWarnings = parseRun?.warnings ?? [];

  const isReviewed = run.status === "approved" || run.status === "published";

  return (
    <>
      <ReviewWorkbench
        run={run}
        originalContent={originalContent}
        parseWarnings={parseWarnings}
        onClose={onClose}
        onDone={onDone}
      />
      {/* WB6：审核导出与实测指标（服务端已保存记录的只读导出） */}
      {run.candidate != null && (
        <div className="mt-4">
          <ExportSection runId={run.id} />
        </div>
      )}
      {/* 已审核/已发布：保留投影状态与版本链（v7.2 既有能力，不丢失） */}
      {isReviewed && run.announcementId && (
        <div className="mt-4">
          <ProjectionSection announcementId={run.announcementId} />
        </div>
      )}
      {isReviewed && run.announcementId && (
        <div className="mt-4">
          <VersionChainSection announcementId={run.announcementId} />
        </div>
      )}
    </>
  );
}

// ==================== 投影状态区（v7.2） ====================

function ProjectionSection({ announcementId }: { announcementId: string }) {
  const [projection, setProjection] = useState<ProjectionStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await announcementsPipelineApi.getProjection(announcementId);
        if (!cancelled) setProjection(p);
      } catch {
        // 投影接口后端并行开发中：未就绪时静默降级，不阻断审核
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  if (unavailable) return null;

  return (
    <div className="mt-4" data-testid="projection-section">
      <p className="text-xs font-semibold text-slate-700 mb-2">用户目录投影</p>
      {!projection ? (
        <p className="text-xs text-slate-400">加载投影状态...</p>
      ) : projection.status === "projected" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          已进入用户目录（v{projection.versionNumber}，{projection.unitCount} 个岗位单元）
        </div>
      ) : projection.status === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          投影失败：{projection.message ?? "未知错误"}
          {projection.fieldPath ? `（${projection.fieldPath}）` : ""}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
          尚未发布到用户目录
        </div>
      )}
    </div>
  );
}

// ==================== 版本链与撤回（v7.2） ====================

const VERSION_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  published: { label: "当前生效", className: "bg-emerald-100 text-emerald-700" },
  superseded: { label: "已被取代", className: "bg-slate-100 text-slate-500" },
  withdrawn: { label: "已撤回", className: "bg-red-100 text-red-700" },
};

function VersionChainSection({ announcementId }: { announcementId: string }) {
  const [versions, setVersions] = useState<PublishedVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const vs = await announcementsPipelineApi.listVersions(announcementId);
      setVersions(vs);
    } catch {
      setVersions([]);
    }
  }, [announcementId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vs = await announcementsPipelineApi.listVersions(announcementId);
        if (!cancelled) setVersions(vs);
      } catch {
        if (!cancelled) setVersions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [announcementId]);

  const handleWithdraw = async (versionId: string) => {
    if (!withdrawReason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await announcementsPipelineApi.withdrawVersion(announcementId, versionId, withdrawReason.trim());
      setWithdrawingId(null);
      setWithdrawReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤回失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (!versions || versions.length === 0) return null;

  return (
    <div className="mt-4" data-testid="version-chain-section">
      <p className="text-xs font-semibold text-slate-700 mb-2">版本链</p>
      <div className="space-y-2">
        {versions.map((v) => {
          const st = VERSION_STATUS_LABELS[v.status] ?? {
            label: v.status,
            className: "bg-slate-100 text-slate-500",
          };
          return (
            <div key={v.id} className="rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">v{v.versionNumber}</span>
                <span className={cn("px-1.5 py-px rounded font-medium", st.className)}>{st.label}</span>
                <span className="text-slate-400">{formatDateTime(v.publishedAt)}</span>
                {v.status === "published" && withdrawingId !== v.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setWithdrawingId(v.id);
                      setWithdrawReason("");
                      setError(null);
                    }}
                  >
                    撤回
                  </Button>
                )}
              </div>

              {v.status === "withdrawn" && (
                <p className="text-slate-500">
                  撤回原因：{v.withdrawReason ?? "—"}
                  {v.withdrawnAt && ` · ${formatDateTime(v.withdrawnAt)}`}
                  {v.withdrawnBy && ` · 操作人：${v.withdrawnBy}`}
                </p>
              )}

              {withdrawingId === v.id && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                  <Input
                    label="撤回原因（必填）"
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="例如：公告被官方撤销"
                  />
                  {error && <p className="text-red-500">⚠️ {error}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleWithdraw(v.id)}
                      disabled={!withdrawReason.trim() || submitting}
                    >
                      {submitting ? "撤回中..." : "确认撤回"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWithdrawingId(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 已发布版本与差异 ====================

function PublishedVersionsSection({ runs }: { runs: Run[] }) {
  const [announcementId, setAnnouncementId] = useState<string>("");
  const [versions, setVersions] = useState<Array<{ id: string; versionNumber: number; status: string; publishedAt: string }>>([]);
  const [diff, setDiff] = useState<Array<{ field: string; before: string; after: string; changed: boolean }> | null>(null);
  const [loading, setLoading] = useState(false);

  const publishedRuns = runs.filter((r) => r.status === "published");

  const loadVersions = async (annId: string) => {
    setAnnouncementId(annId);
    setDiff(null);
    setLoading(true);
    try {
      const vs = await announcementsPipelineApi.listVersions(annId);
      setVersions(
        vs.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          status: v.status,
          publishedAt: v.publishedAt,
        }))
      );
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  const showDiff = async (v1: number, v2: number) => {
    try {
      const result = await announcementsPipelineApi.getVersionDiff(announcementId, v1, v2);
      setDiff(result as Array<{ field: string; before: string; after: string; changed: boolean }>);
    } catch {
      setDiff(null);
    }
  };

  return (
    <Card>
      <p className="text-sm font-semibold text-slate-800 mb-3">已发布版本与差异</p>

      {publishedRuns.length === 0 ? (
        <p className="text-sm text-slate-400">还没有已发布的版本。审核通过后点击「发布」即可创建不可变版本。</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {publishedRuns.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={announcementId === (r.announcementId ?? r.id) ? "primary" : "outline"}
                onClick={() => loadVersions(r.announcementId ?? r.id)}
              >
                {r.snapshot?.source?.publisher ?? r.id.slice(0, 8)} (v{r.publishedVersion?.versionNumber})
              </Button>
            ))}
          </div>

          {announcementId && (
            <div>
              {loading ? (
                <p className="text-xs text-slate-400">加载版本列表...</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-slate-400">暂无版本</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {versions.map((v) => (
                      <span
                        key={v.id}
                        className={cn(
                          "px-2 py-1 rounded text-xs",
                          v.status === "published"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        )}
                      >
                        v{v.versionNumber} · {v.status === "published" ? "当前" : "已取代"} ·{" "}
                        {formatDateTime(v.publishedAt)}
                      </span>
                    ))}
                  </div>

                  {versions.length >= 2 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-slate-700 mb-2">查看版本差异</p>
                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs border border-slate-300 rounded px-2 py-1"
                          onChange={(e) => {
                            const [a, b] = e.target.value.split(",").map(Number);
                            if (a && b) showDiff(a, b);
                          }}
                          defaultValue=""
                        >
                          <option value="">选择两个版本对比...</option>
                          {versions.flatMap((v1, i) =>
                            versions.slice(i + 1).map((v2) => (
                              <option key={`${v1.versionNumber}-${v2.versionNumber}`} value={`${v1.versionNumber},${v2.versionNumber}`}>
                                v{v1.versionNumber} → v{v2.versionNumber}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {diff && (
                        <div className="mt-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
                          {diff.map((d) => (
                            <div key={d.field} className="p-2.5 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-700">
                                  {FIELD_LABELS[d.field] ?? d.field}
                                </span>
                                {d.changed && (
                                  <span className="px-1.5 py-px rounded bg-amber-100 text-amber-700 text-[10px]">
                                    已变更
                                  </span>
                                )}
                              </div>
                              {d.changed ? (
                                <div className="mt-1 flex flex-wrap gap-3">
                                  <span className="text-slate-400 line-through">{d.before || "（空）"}</span>
                                  <span className="text-slate-300">→</span>
                                  <span className="text-slate-800">{d.after || "（空）"}</span>
                                </div>
                              ) : (
                                <p className="mt-1 text-slate-600">{d.after || "（空）"}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
