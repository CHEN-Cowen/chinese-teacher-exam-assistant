"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useCurrentUser } from "@/lib/auth";
import { serviceDeskApi } from "@/lib/service-desk/api";
import type { ServiceDeskConfigView, ServiceDeskPolicyView, TicketPriority } from "@/lib/service-desk/api";

const PRIORITY_ORDER: TicketPriority[] = ["high", "medium", "low"];
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export default function ServiceDeskSettingsPage() {
  const { role } = useCurrentUser();
  const isAdmin = role === "admin";
  const [owners, setOwners] = useState<Array<{ id: string; name: string | null; email: string; role: string }>>([]);
  const [config, setConfig] = useState<ServiceDeskConfigView | null>(null);
  const [policies, setPolicies] = useState<ServiceDeskPolicyView[]>([]);
  const [duty, setDuty] = useState("");
  const [backup, setBackup] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownerRows, configRow, policyRows] = await Promise.all([
        serviceDeskApi.eligibleOwners(),
        serviceDeskApi.getConfig(),
        serviceDeskApi.getPolicies(),
      ]);
      setOwners(ownerRows);
      setConfig(configRow);
      setDuty(configRow.dutyOwnerId ?? "");
      setBackup(configRow.backupOwnerId ?? "");
      setPolicies(policyRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "配置加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, isAdmin]);

  const saveConfig = async () => {
    if (!isAdmin) return;
    setError(null);
    setMessage(null);
    try {
      const next = await serviceDeskApi.updateConfig({
        dutyOwnerId: duty,
        backupOwnerId: backup,
        reason: reason.trim() || undefined,
      });
      setConfig(next);
      setMessage("负责人配置已保存（含修改留痕）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const updatePolicyField = (
    priority: TicketPriority,
    field: "firstResponseHours" | "updateHours" | "escalationGraceHours",
    value: number,
  ) => {
    setPolicies((rows) =>
      rows.map((row) => (row.priority === priority ? { ...row, [field]: value } : row)),
    );
  };

  const savePolicies = async () => {
    if (!isAdmin) return;
    setError(null);
    setMessage(null);
    try {
      const next = await serviceDeskApi.updatePolicies({
        policies: policies.map((row) => ({
          priority: row.priority,
          firstResponseHours: row.firstResponseHours,
          updateHours: row.updateHours,
          escalationGraceHours: row.escalationGraceHours,
        })),
        reason: reason.trim() || undefined,
      });
      setPolicies(next);
      setMessage("时限配置已保存：仅对新阶段生效，既有期限不静默改写");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
        负责人与内部处理时限仅管理员可查看和修改。你可以在
        <Link href="/admin/workbench" className="mx-1 text-brand underline">
          人工工作台
        </Link>
        处理分配给自己的任务。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-bold text-slate-900">人工服务配置</h1>
        <p className="mt-1 text-xs text-slate-500">
          仅管理员可修改。负责人必须是两个不同、启用且具备处理权限的现有员工账号；配置负责人不会自动赋予公告发布等业务权限。
        </p>
        <Link href="/admin/workbench" className="mt-2 inline-block text-xs text-brand underline">
          返回人工工作台
        </Link>
      </header>

      {loading && <p className="text-xs text-slate-500">加载中…</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {message}
        </p>
      )}

      {config && !config.complete && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          运营责任人未配置完整：{config.issues.join("；")}。未分配任务仍会进入管理员可见队列，不会被静默丢弃。
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">运营负责人</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="text-slate-600">日常负责人</span>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2"
              value={duty}
              onChange={(event) => setDuty(event.target.value)}
            >
              <option value="">未选择</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name ?? owner.email}（{owner.role}）
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-slate-600">备用负责人</span>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2"
              value={backup}
              onChange={(event) => setBackup(event.target.value)}
            >
              <option value="">未选择</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name ?? owner.email}（{owner.role}）
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-xs">
          <span className="text-slate-600">修改原因（可选，用于审计）</span>
          <input
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Button className="mt-3" size="sm" onClick={() => void saveConfig()} disabled={loading}>
          保存负责人
        </Button>
        {config?.updatedAt && (
          <p className="mt-2 text-[11px] text-slate-400">
            最后修改：{config.updatedAt}（配置版本 {config.version}）
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">内部处理时限（自然小时，UTC 存储）</h2>
        <p className="mt-1 text-xs text-slate-500">
          这些是内部试运行参数，不是对用户的办结承诺；有效响应指具体公开进展、请求补充或结案，认领与内部备注不算。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-2 py-2">优先级</th>
                <th className="px-2 py-2">首次有效响应</th>
                <th className="px-2 py-2">下一次有效处理更新</th>
                <th className="px-2 py-2">超时后升级宽限</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITY_ORDER.map((priority) => {
                const row = policies.find((item) => item.priority === priority);
                if (!row) return null;
                return (
                  <tr key={priority} className="border-t border-slate-100">
                    <td className="px-2 py-2">{PRIORITY_LABELS[priority]}</td>
                    {(["firstResponseHours", "updateHours", "escalationGraceHours"] as const).map(
                      (field) => (
                        <td key={field} className="px-2 py-2">
                          <input
                            aria-label={`${PRIORITY_LABELS[priority]}-${field}`}
                            type="number"
                            min={1}
                            className="h-8 w-24 rounded border border-slate-200 px-2"
                            value={row[field]}
                            onChange={(event) =>
                              updatePolicyField(priority, field, Number(event.target.value) || 0)
                            }
                          />
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button className="mt-3" size="sm" onClick={() => void savePolicies()} disabled={loading}>
          保存时限（生成新版本）
        </Button>
        <p className="mt-2 text-[11px] text-slate-400">
          现有版本：
          {policies.map((row) => `${PRIORITY_LABELS[row.priority]} v${row.version}`).join("、")}
        </p>
      </section>
    </div>
  );
}
