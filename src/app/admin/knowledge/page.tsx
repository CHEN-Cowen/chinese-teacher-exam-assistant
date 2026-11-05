"use client";


import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { knowledgeApi } from "@/lib/knowledge/api";
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentSummary,
  KnowledgeDocumentType,
  KnowledgeStatus,
  KnowledgeVersionStatus,
} from "@/lib/knowledge/api-types";

const TYPE_OPTIONS: { value: KnowledgeDocumentType; label: string }[] = [
  { value: "announcement", label: "公告正文" },
  { value: "attachment", label: "岗位/附件" },
  { value: "policy", label: "地区政策" },
  { value: "other", label: "其他官方材料" },
];

const STATUS_FILTERS = [
  { value: "", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "review", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "published", label: "已发布" },
  { value: "withdrawn", label: "已撤回" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  review: "待审核",
  approved: "已通过",
  published: "已发布",
  withdrawn: "已撤回",
  draft_rejected: "已退回",
};

function statusVariant(status: string): "default" | "primary" | "success" | "warning" | "danger" | "muted" {
  if (status === "published") return "success";
  if (status === "approved") return "primary";
  if (status === "review") return "warning";
  if (status === "withdrawn") return "danger";
  if (status === "superseded") return "muted";
  return "default";
}

const VERSION_ACTION_LABEL: Record<KnowledgeVersionStatus, string> = {
  draft: "提交审核",
  review: "审核",
  approved: "发布",
  published: "重建索引",
  withdrawn: "—",
  superseded: "—",
};

export default function AdminKnowledgePage() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocumentSummary[]>([]);
  const [selected, setSelected] = useState<KnowledgeDocumentDetail | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>("policy");
  const [regionCode, setRegionCode] = useState("");
  const [year, setYear] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [applicableAudience, setApplicableAudience] = useState("");
  const [applicableSubjects, setApplicableSubjects] = useState("");
  const [content, setContent] = useState("");
  const [base64, setBase64] = useState("");
  const [fileName, setFileName] = useState("");

  const load = useCallback(async () => {
    try {
      const [statusRes, listRes] = await Promise.all([
        knowledgeApi.status(),
        knowledgeApi.listDocuments({ status: filter || undefined, limit: 20 }),
      ]);
      setStatus(statusRes);
      setDocs(listRes.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [filter]);

  useEffect(() => {
    // 异步包装：状态更新发生在请求回调中，避免同步 effect 级联渲染
    void (async () => {
      await load();
    })();
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
      if (selected) {
        setSelected(await knowledgeApi.getDocument(selected.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    setBase64(btoa(binary));
    setFileName(file.name);
    setContent("");
  }

  function submitCreate() {
    const payload = {
      title: title.trim(),
      documentType,
      ...(regionCode.trim() ? { regionCode: regionCode.trim() } : {}),
      ...(year.trim() ? { year: Number(year) } : {}),
      ...(officialUrl.trim() ? { officialUrl: officialUrl.trim() } : {}),
      ...(effectiveFrom.trim() ? { effectiveFrom: effectiveFrom.trim() } : {}),
      ...(effectiveTo.trim() ? { effectiveTo: effectiveTo.trim() } : {}),
      ...(applicableAudience.trim() ? { applicableAudience: applicableAudience.trim() } : {}),
      ...(applicableSubjects.trim()
        ? {
            applicableSubjects: applicableSubjects
              .split(/[,，、]/)
              .map((item) => item.trim())
              .filter(Boolean),
          }
        : {}),
      ...(base64 ? { base64, fileName } : {}),
      ...(!base64 && content.trim() ? { content } : {}),
    };
    if (!payload.title) {
      setError("请填写材料标题");
      return;
    }
    if (!base64 && !content.trim()) {
      setError("请粘贴正文或上传原件");
      return;
    }
    void run(async () => {
      await knowledgeApi.createDocument(payload);
      setTitle("");
      setContent("");
      setBase64("");
      setFileName("");
      setOfficialUrl("");
    }, "已入库为草稿，需审核后才能公开检索");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">知识库材料</h1>
          <p className="mt-1 text-sm text-ink-muted">
            官方材料入库、审核、发布与索引状态。未审核/未发布材料不会进入公开问答。
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} loading={busy}>
          刷新
        </Button>
      </div>

      {status && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-sm text-ink-muted">模型模式</div>
            <div className="mt-1 font-semibold text-ink">
              {status.ai.mode ?? "未启用"}
              {status.enabled ? "" : "（未启用）"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-ink-muted">向量存储</div>
            <div className="mt-1 font-semibold text-ink">
              {status.vector.pgvectorAvailable ? "pgvector" : "Float[] 降级"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-ink-muted">已发布材料 / 版本</div>
            <div className="mt-1 font-semibold text-ink">
              {status.counts.documents} / {status.counts.versions}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-ink-muted">索引任务 / 片段</div>
            <div className="mt-1 font-semibold text-ink">
              {status.counts.jobs} / {status.counts.chunks}
            </div>
          </Card>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/30 bg-no-bg px-4 py-3 text-sm text-no-ink">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-ok-ink/20 bg-ok-bg px-4 py-3 text-sm text-ok-ink">
          {notice}
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-ink">新增材料</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Input label="标题" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2026 年杭州市教师招聘公告" />
          <Select
            label="材料类型"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as KnowledgeDocumentType)}
            options={TYPE_OPTIONS}
          />
          <Input label="地区代码（可选）" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} placeholder="如 330100" />
          <Input label="适用年份（可选）" value={year} onChange={(e) => setYear(e.target.value)} placeholder="如 2026" />
          <Input label="生效日期（可选）" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} placeholder="如 2026-01-01" />
          <Input label="失效日期（可选）" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} placeholder="如 2026-12-31；留空表示未标注" />
          <Input label="适用对象（可选）" value={applicableAudience} onChange={(e) => setApplicableAudience(e.target.value)} placeholder="如：教师公开招聘" />
          <Input label="适用学科（可选，逗号分隔）" value={applicableSubjects} onChange={(e) => setApplicableSubjects(e.target.value)} placeholder="如：chinese,mathematics；留空表示不限" />
          <Input label="官方链接（可选）" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} placeholder="填写官方原文链接" />
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">原件上传（PDF/Word/Excel/HTML）</label>
            <input
              type="file"
              className="block w-full text-sm text-ink-muted"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            {fileName && <p className="mt-1 text-[13px] text-ink-muted">已选择：{fileName}</p>}
          </div>
        </div>
        {!base64 && (
          <div className="mt-4">
            <Textarea
              label="或粘贴正文（纯文本/HTML）"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴公告正文或政策原文"
            />
          </div>
        )}
        <div className="mt-4">
          <Button onClick={submitCreate} loading={busy}>
            入库为草稿
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">材料列表</h2>
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={STATUS_FILTERS}
            className="max-w-[200px]"
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="py-2 pr-3">标题</th>
                <th className="py-2 pr-3">类型</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">版本</th>
                <th className="py-2 pr-3">索引版本</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-b border-line/70">
                  <td className="py-3 pr-3 text-ink">{doc.title}</td>
                  <td className="py-3 pr-3 text-ink-muted">
                    {TYPE_OPTIONS.find((item) => item.value === doc.documentType)?.label ?? doc.documentType}
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant={statusVariant(doc.status)}>{STATUS_LABEL[doc.status] ?? doc.status}</Badge>
                  </td>
                  <td className="py-3 pr-3 text-ink-muted">{doc.versionCount}</td>
                  <td className="py-3 pr-3 text-ink-muted">{doc.activeIndexVersion ?? "—"}</td>
                  <td className="py-3">
                    <Button
                      variant="link"
                      onClick={() =>
                        void run(async () => {
                          setSelected(await knowledgeApi.getDocument(doc.id));
                        }, "已加载详情")
                      }
                    >
                      详情
                    </Button>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-muted">
                    暂无材料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{selected.title}</h2>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  const reason = window.prompt("撤回原因（必填，撤回后立即退出公开检索）");
                  if (!reason) return;
                  void run(
                    () => knowledgeApi.withdraw(selected.id, reason),
                    "已撤回并清理该版本向量",
                  );
                }}
              >
                撤回
              </Button>
              <Button variant="outline" onClick={() => setSelected(null)}>
                关闭
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {selected.versions.map((version) => {
              const latestJob = version.jobs?.[0];
              return (
                <div key={version.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-ink">v{version.versionNumber}</span>
                    <Badge variant={statusVariant(version.status)}>
                      {STATUS_LABEL[version.status] ?? version.status}
                    </Badge>
                    <span className="text-xs text-ink-muted">片段 {version._count?.chunks ?? 0}</span>
                    <span className="text-xs text-ink-muted">
                      切分器 {version.chunkerVersion} · 解析器 {version.parserVersion}
                    </span>
                    {latestJob && (
                      <span className="text-xs text-ink-muted">
                        索引任务：{latestJob.status}
                        {latestJob.errorClass ? `（${latestJob.errorClass}）` : ""}
                      </span>
                    )}
                  </div>
                  {latestJob?.errorMessage && (
                    <p className="mt-2 text-xs text-danger">索引失败：{latestJob.errorMessage}</p>
                  )}
                  {version.reviewNote && (
                    <p className="mt-2 text-xs text-ink-muted">审核备注：{version.reviewNote}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {version.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void run(() => knowledgeApi.submitReview(version.id), "已提交审核")
                        }
                      >
                        提交审核
                      </Button>
                    )}
                    {version.status === "review" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              () => knowledgeApi.approve(version.id, "审核通过"),
                              "已审核通过",
                            )
                          }
                        >
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const note = window.prompt("退回原因");
                            if (note === null) return;
                            void run(() => knowledgeApi.reject(version.id, note), "已退回草稿");
                          }}
                        >
                          退回
                        </Button>
                      </>
                    )}
                    {version.status === "approved" && (
                      <Button
                        size="sm"
                        onClick={() => void run(async () => {
                          const result = await knowledgeApi.publish(version.id);
                          if (!result.indexJob?.queued && result.indexJob?.warning) {
                            throw new Error(`已发布，但${result.indexJob.warning}`);
                          }
                        }, "已发布并投递索引任务")}
                      >
                        发布
                      </Button>
                    )}
                    {(version.status === "published" || version.status === "approved") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void run(async () => {
                          const result = await knowledgeApi.rebuildIndex(version.id);
                          if (!result.queued && result.warning) {
                            throw new Error(result.warning);
                          }
                        }, "已投递索引任务")}
                      >
                        重建索引
                      </Button>
                    )}
                    {VERSION_ACTION_LABEL[version.status] === "—" && (
                      <span className="text-xs text-ink-muted">该版本不可再操作</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
