"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { Hero } from "@/components/ia/Hero";
import { Disclosure } from "@/components/ia/Layer";
import { StatusMessage, StatusMessageRegion } from "@/components/ui/StatusMessage";
import { Callout } from "@/components/ui/Callout";
import { useCurrentExamTarget } from "@/lib/targets/useCurrentExamTarget";
import { materialService } from "@/lib/materials/materialService";
import { useMaterialsModule } from "@/lib/materials/useMaterials";
import { InventoryStatusPicker } from "@/components/materials/InventoryStatusPicker";
import { MaterialForm } from "@/components/materials/MaterialForm";
import { MaterialListItem } from "@/components/materials/MaterialListItem";
import { AbilityBaselineForm } from "@/components/materials/AbilityBaselineForm";
import { DiagnosisPanel } from "@/components/materials/DiagnosisPanel";
import { PublicResourceList } from "@/components/materials/PublicResourceList";
import { MaterialItem, USAGE_STATUS_LABELS } from "@/types";

const TABS = [
  { id: "materials", label: "资料" },
  { id: "baseline", label: "准备情况" },
  { id: "diagnosis", label: "使用建议" },
  { id: "public", label: "补充资源" },
];

export function MaterialsView() {
  const target = useCurrentExamTarget();
  const { materials, baseline, snapshot, readiness, stale } = useMaterialsModule(target?.id ?? null);
  const [activeTab, setActiveTab] = useState("materials");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialItem | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; message: string } | null>(null);

  if (!target) {
    return (
      <EmptyState
        icon={<span className="text-4xl">🎯</span>}
        title="先确认你准备的考试"
        description="资料怎么用只针对你准备的考试：先确定报考地区与考试，再整理资料。"
        actionLabel="去设置目标"
        actionHref="/opportunities"
      />
    );
  }

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (material: MaterialItem) => {
    setEditing(material);
    setFormOpen(true);
  };

  const diagnosisByMaterial = new Map((snapshot?.materialDiagnoses ?? []).map((d) => [d.materialId, d]));
  const missingCount = snapshot?.missingModules.length ?? 0;
  const targetScope = [
    target.region,
    target.educationLevel === "middle"
      ? "初中"
      : target.educationLevel === "primary"
        ? "小学"
        : target.educationLevel === "high"
          ? "高中"
          : "",
    target.year ? `${target.year}` : "",
  ].filter(Boolean).join(" · ");

  const heroConclusion = materials.length === 0
    ? "先整理一份核心资料，再判断它适不适合这次考试"
    : !snapshot
      ? `已整理 ${materials.length} 份资料，下一步分析该怎么用`
      : stale
        ? "资料或考情发生了变化，需要更新使用建议"
        : missingCount > 0
          ? `已完成资料分析，还有 ${missingCount} 个关键模块需要补齐`
          : "资料主干已覆盖，可以按当前建议开始准备";

  const showDiagnosis = () => setActiveTab("diagnosis");

  return (
    <div className="space-y-7">
      <Hero
        meta={`${target.name} · ${targetScope}`}
        conclusion={heroConclusion}
        action={
          materials.length === 0
            ? { label: "新增第一份资料", onClick: openCreate }
            : { label: stale || !snapshot ? "查看并更新使用建议" : "查看资料使用建议", onClick: showDiagnosis }
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          {materials.length === 0
            ? "只需填写资料名称和大致目录，不用上传整份文件。"
            : `当前有 ${materials.length} 份资料${snapshot ? `，已分析 ${snapshot.materialDiagnoses.length} 份` : ""}。系统只结合这次考试的已核对考情给出建议。`}
        </p>
      </Hero>

      {stale && (
        <Callout variant="note" title="资料或考情已变化">
          上次分析后资料或考试内容发生了变化，当前使用建议可能已过时。前往「使用建议」更新分析。
        </Callout>
      )}

      {target.name.includes("【演示案例") && (
        <Disclosure title="这是内置演示目标">
          <p className="text-xs leading-relaxed text-ink-muted">
            可在机会页切换当前主目标，或在设置中清空本地演示数据。资料只保存在当前浏览器中，不构成购买建议。
          </p>
        </Disclosure>
      )}

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab}>
        {/* ==================== 我的资料 ==================== */}
        <TabPanel id="materials" activeTab={activeTab}>
          <div className="space-y-4">
            {materials.length === 0 ? (
              <EmptyState
                icon={<span className="text-xl" aria-hidden="true">＋</span>}
                title="这次考试下还没有资料"
                actionLabel="新增我的第一份资料"
                onAction={openCreate}
              />
            ) : (
              <>
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm font-medium text-ink">
                    已整理 {materials.length} 份资料
                    {snapshot && <Badge variant="muted" className="ml-2">已分析 {snapshot.materialDiagnoses.length} 份</Badge>}
                  </p>
                  <Button variant="outline" size="sm" onClick={openCreate}>
                    新增资料
                  </Button>
                </div>
                <div className="space-y-3">
                  {materials.map((material) => (
                    <MaterialListItem
                      key={material.id}
                      material={material}
                      diagnosis={diagnosisByMaterial.get(material.id)}
                      onEdit={openEdit}
                    />
                  ))}
                </div>
              </>
            )}

            <Disclosure title={`资料数量状态：${USAGE_STATUS_LABELS[baseline?.inventoryStatus ?? "none"]}`}>
              <InventoryStatusPicker
                value={baseline?.inventoryStatus ?? "none"}
                onSelect={(status) => {
                  materialService.setInventoryStatus(target.id, status);
                  setFeedback({ id: Date.now(), message: "资料数量状态已更新，后续使用建议会据此调整。" });
                }}
              />
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                新增或删除资料后会自动同步；只有实际情况不一致时才需要手动调整。
              </p>
            </Disclosure>
          </div>
        </TabPanel>

        {/* ==================== 能力基线 ==================== */}
        <TabPanel id="baseline" activeTab={activeTab}>
          {baseline && (
            <>
              <p className="mb-3 text-xs text-ink-muted">
                准备情况用于判断资料怎么用（如时间不足时收缩并行资料、薄弱模块优先保留），只保存在本地，不与公共资源混用。
              </p>
              <AbilityBaselineForm key={target.id} baseline={baseline} />
            </>
          )}
        </TabPanel>

        {/* ==================== 诊断结果 ==================== */}
        <TabPanel id="diagnosis" activeTab={activeTab}>
          <DiagnosisPanel
            target={target}
            targetId={target.id}
            inventoryStatus={baseline?.inventoryStatus ?? "none"}
            materials={materials}
            snapshot={snapshot}
            readiness={readiness}
            stale={stale}
          />
        </TabPanel>

        {/* ==================== 公共资源 ==================== */}
        <TabPanel id="public" activeTab={activeTab}>
          <PublicResourceList />
        </TabPanel>
      </Tabs>

      {formOpen && (
        <MaterialForm
          targetId={target.id}
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(name) => {
            setFormOpen(false);
            setFeedback({ id: Date.now(), message: `《${name}》已保存，可以继续完善准备情况或查看使用建议。` });
          }}
        />
      )}

      {feedback && (
        <StatusMessageRegion className="bottom-20 md:bottom-4">
          <StatusMessage
            key={feedback.id}
            message={feedback.message}
            action={{ label: "查看建议", onClick: showDiagnosis }}
            onDismiss={() => setFeedback(null)}
          />
        </StatusMessageRegion>
      )}
    </div>
  );
}
