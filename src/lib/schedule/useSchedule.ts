"use client";

import { useCallback, useEffect, useState } from "react";
import { scheduleApi } from "./api";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { track, classifyErrorCode } from "@/lib/analytics/eventService";
import type { ScheduleResponse } from "./types";

export type ScheduleLoadState =
  | { status: "loading" }
  | { status: "ready"; data: ScheduleResponse }
  | { status: "error"; error: string };

export interface UseScheduleResult {
  state: ScheduleLoadState;
  reload: () => Promise<void>;
  /** 切换单个机会的站内提醒开关 */
  toggleMute: (unitId: string, muted: boolean) => Promise<void>;
  muteBusy: boolean;
}

/**
 * 报名日程数据：进入日程页时同步最新公告版本并拉取事件。
 * 静音切换只影响通知生成，不影响日程展示；失败不破坏已有数据。
 */
export function useSchedule(): UseScheduleResult {
  const [state, setState] = useState<ScheduleLoadState>({ status: "loading" });
  const [muteBusy, setMuteBusy] = useState(false);

  const fetchSchedule = useCallback(
    () => scheduleApi.getSchedule(),
    [],
  );

  // 初次加载：setState 只在异步回调中
  useEffect(() => {
    let cancelled = false;
    fetchSchedule()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
        // v7.1 M9：日程自动同步成功，记节点数不记公告正文
        track("schedule_sync_completed", "schedule", {
          props: { status: "success", nodeCount: data.events.length },
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: err instanceof Error ? err.message : "加载失败",
          });
        }
        // v7.1 M9：日程自动同步失败，记错误码不记原始报错
        track("schedule_sync_completed", "schedule", {
          props: { status: "failure", reasonCode: classifyErrorCode(err) },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSchedule]);

  // 用户触发的重试：先切到 loading
  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const data = await fetchSchedule();
      setState({ status: "ready", data });
      track("schedule_sync_completed", "schedule", {
        props: { status: "success", nodeCount: data.events.length },
      });
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : "加载失败",
      });
      track("schedule_sync_completed", "schedule", {
        props: { status: "failure", reasonCode: classifyErrorCode(err) },
      });
    }
  }, [fetchSchedule]);

  const toggleMute = useCallback(async (unitId: string, muted: boolean) => {
    setMuteBusy(true);
    try {
      await opportunitiesApi.setRemindersMuted(unitId, muted);
      // 乐观更新：直接改本地 mutedUnitIds，避免重新同步
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const set = new Set(prev.data.mutedUnitIds);
        if (muted) set.add(unitId);
        else set.delete(unitId);
        return {
          ...prev,
          data: { ...prev.data, mutedUnitIds: Array.from(set) },
        };
      });
    } catch {
      // 失败时回滚到服务器状态
      await reload();
    } finally {
      setMuteBusy(false);
    }
  }, [reload]);

  return { state, reload, toggleMute, muteBusy };
}
