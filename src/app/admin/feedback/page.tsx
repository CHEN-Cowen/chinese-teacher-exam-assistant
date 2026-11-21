"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CorrectionQueuePanel } from "@/components/admin/CorrectionQueuePanel";
import { RetractionLogList } from "@/components/admin/RetractionLogList";
import { OpportunityCorrectionPanel } from "@/components/admin/OpportunityCorrectionPanel";
import { AnnouncementSubmissionPanel } from "@/components/admin/AnnouncementSubmissionPanel";

const TABS = [
  { id: "opportunity-corrections", label: "机会纠错" },
  { id: "submissions", label: "公告补录" },
  { id: "corrections", label: "考情纠错队列" },
  { id: "retractions", label: "结论撤回留痕" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * 纠错与治理后台（/admin/feedback）：
 * - 机会纠错：用户对机会单元提交的纠错，采纳后登记修正版本；
 * - 公告补录（D08）：用户提交的未收录官方公告，只进受理闭环，不直发采集；
 * - 考情纠错队列与错误结论撤回留痕：既有治理能力。
 * 处理结果通过站内通知告知用户；普通用户只能看到自己的提交。
 */
export default function AdminFeedbackPage() {
  const [tab, setTab] = useState<TabId>("opportunity-corrections");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">纠错与治理</h1>
        <p className="mt-1 text-sm text-slate-500">
          处理用户提交的纠错与公告补录；撤回错误结论时会识别受影响目标、计划与用户并发送变化说明。
          所有处理动作均有留痕，普通用户只能看到自己的提交。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md transition-colors",
              tab === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "opportunity-corrections" ? (
        <OpportunityCorrectionPanel />
      ) : tab === "submissions" ? (
        <AnnouncementSubmissionPanel />
      ) : tab === "corrections" ? (
        <CorrectionQueuePanel />
      ) : (
        <RetractionLogList />
      )}
    </div>
  );
}
