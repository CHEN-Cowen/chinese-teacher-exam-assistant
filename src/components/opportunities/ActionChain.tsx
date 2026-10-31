"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FOLLOW_STATUS_LABELS } from "@/lib/opportunities";
import type { FollowDTO } from "@/lib/opportunities/api-types";
import { track } from "@/lib/analytics/eventService";
import { materialProgressText } from "./MaterialsList";
import type { MaterialItemDTO } from "@/lib/opportunities/api-types";
import { safeOfficialLink } from "@/lib/links/official";

interface ActionChainProps {
  follow: FollowDTO | null;
  /** 报考单元 ID：进入官方报名入口的埋点归属（模块 7） */
  unitId?: string;
  missingInfoCount: number;
  confirmOfficialCount: number;
  materials: MaterialItemDTO[];
  /** 报名截止倒计时文案，如「10月20日 周二 截止，还剩 16 天」 */
  deadlineText: string;
  officialUrl: string;
  busy: boolean;
  onGoMissingInfo: () => void;
  onGoConfirm: () => void;
  onPrepare: () => void;
  /** 打开官方报名入口后，用户确认已完成报名时调用 */
  onMarkRegistered: () => void;
}

/**
 * 关注后行动链（模块 6）：每个状态一个主按钮。
 * considering + 有缺信息 → 去补信息；considering + 有需确认 → 去确认；
 * considering（无）→ 开始准备报名材料；preparing → 进入官方报名入口；
 * registered → 已报名（禁用）；abandoned/closed → 不展示主按钮。
 */
export function ActionChain({
  follow,
  unitId,
  missingInfoCount,
  confirmOfficialCount,
  materials,
  deadlineText,
  officialUrl,
  busy,
  onGoMissingInfo,
  onGoConfirm,
  onPrepare,
  onMarkRegistered,
}: ActionChainProps) {
  const [confirmRegistered, setConfirmRegistered] = useState(false);

  if (!follow) return null;

  const status = follow.status;
  const progress = materialProgressText(materials, follow.materialStatuses);
  const registrationLink = safeOfficialLink(officialUrl);

  const primary = (() => {
    if (status === "registered") {
      return { label: "已报名", disabled: true };
    }
    if (status === "abandoned" || status === "closed") {
      return null;
    }
    if (status === "considering") {
      if (missingInfoCount > 0) {
        return { label: `去补信息（${missingInfoCount} 项）`, onClick: onGoMissingInfo };
      }
      if (confirmOfficialCount > 0) {
        return { label: `去确认（${confirmOfficialCount} 项）`, onClick: onGoConfirm };
      }
      return { label: "开始准备报名材料", onClick: onPrepare };
    }
    // preparing
    return {
      label: registrationLink ? "进入官方报名入口" : "模拟报名入口（无真实链接）",
      onClick: () => {
        // 虚构示例绝不打开占位域名，也不计为真实进入报名入口。
        if (unitId && registrationLink) {
          track("register_entry_opened", "opportunity", { targetId: unitId });
        }
        if (registrationLink) window.open(registrationLink, "_blank", "noreferrer");
        setConfirmRegistered(true);
      },
    };
  })();

  return (
    <section className="space-y-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">报考行动</h2>
        <span className="inline-flex h-6 items-center rounded bg-surface px-2.5 text-xs font-medium text-ink-muted ring-1 ring-line">
          {FOLLOW_STATUS_LABELS[status]}
        </span>
      </div>

      <p className="text-sm text-ink-muted">
        报名{deadlineText} · 材料进度：{progress}
      </p>

      {primary && (
        <Button
          className="w-full sm:w-auto"
          disabled={busy || primary.disabled}
          onClick={primary.onClick}
        >
          {primary.label}
        </Button>
      )}

      {status === "preparing" && (
        <p className="text-xs text-ink-muted">
          {registrationLink
            ? "报名始终在官方入口完成，产品不代理报名。进入官方入口后可在此标记「已报名」。"
            : "这是虚构演示机会，没有真实报名入口；下方状态仅用于体验操作。"}
        </p>
      )}

      {confirmRegistered && (
        <div className="flex items-center gap-2 rounded-lg bg-surface p-3 ring-1 ring-line">
          <span className="text-sm text-ink">{registrationLink ? "是否已在官方入口完成报名？" : "是否模拟标记为已报名？"}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmRegistered(false)}
          >
            还没有
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setConfirmRegistered(false);
              onMarkRegistered();
            }}
          >
            我已完成报名
          </Button>
        </div>
      )}
    </section>
  );
}
