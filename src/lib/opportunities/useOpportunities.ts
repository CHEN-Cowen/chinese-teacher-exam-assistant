"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AUTH_MODE, useCurrentUser } from "@/lib/auth";
import {
  buildActiveProfile,
  type ActiveProfileReason,
} from "@/lib/profile/activeProfile";
import { profileApi } from "@/lib/profile/profileApi";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { opportunitiesApi } from "./api";
import { trackOncePerUser } from "@/lib/analytics/eventService";
import type {
  FollowStatus,
  MatchResponse,
  StudyTargetRole,
  UnitMatchDTO,
} from "./api-types";
import { USER_COPY } from "@/lib/ux/userCopy";
import { upsertGuestFollow } from "@/lib/guest/guestFollows";
import { useRouter } from "next/navigation";

/** invited 模式占位画像：后端会忽略请求体，读取已持久化画像 */
const INVITED_PLACEHOLDER_PROFILE = {} as UserRecruitmentProfile;

/** P0 漏斗②：匹配成功且至少有一个初步符合（有效）机会；同用户只记一次 */
function recordRevealed(data: MatchResponse): void {
  const validCount = data.groups.preliminary.length;
  if (validCount <= 0) return;
  trackOncePerUser("opportunity_revealed", "opportunity", {
    targetId: data.groups.preliminary[0]?.unit.id,
    props: { validCount },
  });
}

export type OpportunitiesLoadState =
  | { status: "loading" }
  | { status: "no-profile"; reason: ActiveProfileReason }
  | {
      status: "ready";
      data: MatchResponse;
      profile: UserRecruitmentProfile;
    }
  | { status: "error"; error: string };

export interface OpportunitiesApi {
  state: OpportunitiesLoadState;
  reload: () => Promise<void>;
  followBusyId: string | null;
  actionError: string | null;
  actionFeedback: { kind: "saved" | "removed"; message: string } | null;
  clearActionFeedback: () => void;
  toggleFollow: (unit: UnitMatchDTO) => Promise<void>;
}

function computeInitialState():
  | { status: "loading" }
  | { status: "no-profile"; reason: ActiveProfileReason } {
  if (AUTH_MODE === "invited") return { status: "loading" };
  const active = buildActiveProfile();
  return active.ready
    ? { status: "loading" }
    : { status: "no-profile", reason: active.reason };
}

/**
 * 机会列表数据（v7.1 M8：访客可免登录查看匹配结果）。
 * - demo：画像来自本机基础画像草稿 + 补充事实；
 * - invited + 已登录：画像由后端读取已持久化数据；
 * - invited + 未登录：使用本机访客画像，通过请求体发送给后端。
 */
export function useOpportunities(): OpportunitiesApi {
  const { status: authStatus } = useCurrentUser();
  const router = useRouter();
  const [state, setState] = useState<OpportunitiesLoadState>(computeInitialState);
  const [followBusyId, setFollowBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    kind: "saved" | "removed";
    message: string;
  } | null>(null);

  /** invited 模式下是否是访客（未登录） */
  const isGuest = AUTH_MODE === "invited" && authStatus !== "authenticated";

  const loadProfile = useCallback(async (): Promise<UserRecruitmentProfile | null> => {
    if (AUTH_MODE === "invited" && authStatus === "authenticated") {
      return profileApi.getProfile();
    }
    // 未登录 invited 或 demo：使用本机访客画像
    const active = buildActiveProfile();
    return active.ready ? active.profile : null;
  }, [authStatus]);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setState({ status: "loading" });
    try {
      const profile = await loadProfile();
      if (!profile) {
        setState({ status: "no-profile", reason: "incomplete" });
        return;
      }
      const data = await opportunitiesApi.match(profile, { sendProfile: isGuest });
      recordRevealed(data);
      setState({ status: "ready", data, profile });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "机会加载失败";
      if (msg.includes("尚未保存画像")) {
        setState({ status: "no-profile", reason: "incomplete" });
      } else {
        setState({ status: "error", error: msg });
      }
    }
  }, [loadProfile, isGuest]);

  // 初次加载与认证状态变化时重载
  // v7.1 M8：invited 模式下等待会话恢复完成后再加载
  useEffect(() => {
    if (AUTH_MODE === "invited" && authStatus === "loading") return;
    let cancelled = false;
    (async () => {
      const profile = await loadProfile();
      if (cancelled) return;
      if (profile === null) {
        setState({ status: "no-profile", reason: "incomplete" });
        return;
      }
      const data = await opportunitiesApi.match(profile, { sendProfile: isGuest });
      if (!cancelled) {
        recordRevealed(data);
        setState({ status: "ready", data, profile });
      }
    })().catch((error) => {
      if (!cancelled) {
        const msg = error instanceof Error ? error.message : "机会加载失败";
        if (msg.includes("尚未保存画像")) {
          setState({ status: "no-profile", reason: "incomplete" });
        } else {
          setState({ status: "error", error: msg });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authStatus, loadProfile, isGuest]);

  const toggleFollow = useCallback(
    async (unit: UnitMatchDTO) => {
      // v7.1 M8：未登录用户保存机会时先暂存到本机，再跳登录
      if (isGuest && !unit.follow) {
        upsertGuestFollow(unit.unit.id, { status: "considering" });
        router.push(`/login?next=/opportunities/${unit.unit.id}&reason=save`);
        return;
      }
      setFollowBusyId(unit.unit.id);
      setActionError(null);
      setActionFeedback(null);
      try {
        if (unit.follow) {
          await opportunitiesApi.unfollow(unit.unit.id);
          setActionFeedback({ kind: "removed", message: USER_COPY.FOLLOW.REMOVED });
        } else {
          await opportunitiesApi.follow(unit.unit.id);
          setActionFeedback({ kind: "saved", message: USER_COPY.FOLLOW.ADDED });
        }
        await reload(true);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "操作失败");
      } finally {
        setFollowBusyId(null);
      }
    },
    [isGuest, reload, router],
  );

  return {
    state,
    reload: () => reload(false),
    followBusyId,
    actionError,
    actionFeedback,
    clearActionFeedback: () => setActionFeedback(null),
    toggleFollow,
  };
}

export type ActiveProfileLoadState =
  | { status: "loading" }
  | { status: "no-profile"; reason: ActiveProfileReason }
  | { status: "ready"; profile: UserRecruitmentProfile; isGuest: boolean };

/**
 * 供详情页复用的画像读取（v7.1 M8：响应认证状态）。
 * - demo + 未登录：本地草稿 + 补充事实（isGuest=true，保存/设主要目标触发登录）；
 * - demo + 已登录演示账号：同用本地画像，但 isGuest=false，不再重复触发登录跳转；
 * - invited + 已登录：占位 ready，由后端读取已持久化画像（isGuest=false）；
 * - invited + 未登录：使用本机访客画像（isGuest=true），通过请求体发送。
 */
export function useActiveProfile(): ActiveProfileLoadState {
  const { status: authStatus } = useCurrentUser();
  return useMemo<ActiveProfileLoadState>(() => {
    if (AUTH_MODE === "invited") {
      if (authStatus === "loading") return { status: "loading" };
      if (authStatus === "authenticated") {
        return { status: "ready", profile: INVITED_PLACEHOLDER_PROFILE, isGuest: false };
      }
      // 未登录：使用本机访客画像
      const active = buildActiveProfile();
      return active.ready
        ? { status: "ready", profile: active.profile, isGuest: true }
        : { status: "no-profile", reason: active.reason };
    }
    // demo 模式：本地草稿 + 补充事实。会话恢复完成前先等待，避免把已登录演示账号
    // 短暂误判为访客而触发多余的登录跳转。
    if (authStatus === "loading") return { status: "loading" };
    const active = buildActiveProfile();
    return active.ready
      ? {
          status: "ready",
          profile: active.profile,
          isGuest: authStatus !== "authenticated",
        }
      : { status: "no-profile", reason: active.reason };
  }, [authStatus]);
}

export type { FollowStatus, StudyTargetRole };
