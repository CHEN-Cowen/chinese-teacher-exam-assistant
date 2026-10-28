"use client";

/**
 * 偏好调整影响预览卡片（D04 / PRD 11.5）。
 *
 * 流程：调整地区级别/用工偏好 → 预览影响（只读计算，不落库）→ 确认应用 → 可撤销。
 * - 预览复用后端同一匹配接口（POST /match 只读，请求体画像不持久化）；
 * - 过期响应保护：请求序号丢弃旧响应 + 目录版本不一致时丢弃预览；
 * - 确认前不写任何持久化；撤销快照存 localStorage（跨标签页与整页刷新仍可撤销，
 *   30 分钟有效），存储不可用时本会话内内存态仍可撤销；
 * - 预览失败明确提示，不编造数量。
 */
import { useRef, useState } from "react";
import { AUTH_MODE, useCurrentUser } from "@/lib/auth";
import { guestSessionService, REGION_LEVEL_OPTIONS, NATURE_PREFERENCE_OPTIONS } from "@/lib/guest/guestSession";
import type { EmploymentNaturePreference } from "@/lib/guest/guestSession";
import { profileApi } from "@/lib/profile/profileApi";
import type { RegionPreference, UserRecruitmentProfile } from "@/lib/profile/types";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type { MatchResponse } from "@/lib/opportunities/api-types";
import { buildListViewModel } from "@/lib/opportunities/list-view";
import {
  buildPreferencePreview,
  isSameCatalog,
  type PreferencePreviewResult,
} from "@/lib/opportunities/preference-preview";

const UNDO_STORAGE_KEY = "kb_preference_undo_v1";
/** 撤销快照有效期：超过后视为离开上下文，不再提示撤销 */
const UNDO_TTL_MS = 30 * 60 * 1000;

interface UndoSnapshot {
  regions: RegionPreference[];
  employmentNaturePreference?: EmploymentNaturePreference;
  savedAt: string;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: PreferencePreviewResult }
  | { status: "stale" }
  | { status: "error"; message: string };

function readUndoSnapshot(): UndoSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    // localStorage：sessionStorage 按标签页隔离，跨标签/新开页面后撤销会丢失
    const raw = window.localStorage.getItem(UNDO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UndoSnapshot;
    if (Date.now() - Date.parse(parsed.savedAt) > UNDO_TTL_MS) return null;
    if (!Array.isArray(parsed.regions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function samePreferences(
  regions: RegionPreference[],
  nature: EmploymentNaturePreference | undefined,
  profile: UserRecruitmentProfile,
): boolean {
  return (
    JSON.stringify(regions) === JSON.stringify(profile.regions) &&
    nature === profile.employmentNaturePreference
  );
}

export function PreferencePreviewCard({
  profile,
  response,
  onApplied,
}: {
  profile: UserRecruitmentProfile;
  response: MatchResponse;
  onApplied: () => void;
}) {
  const { status: authStatus } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [draftRegions, setDraftRegions] = useState<RegionPreference[]>(profile.regions);
  const [draftNature, setDraftNature] = useState<EmploymentNaturePreference | undefined>(
    profile.employmentNaturePreference,
  );
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoSnapshot | null>(readUndoSnapshot);
  /** 快速切换过期响应保护：只接受最后一次预览请求的结果 */
  const requestSeq = useRef(0);
  const dirty = !samePreferences(draftRegions, draftNature, profile);

  // 画像被外部更新（应用/撤销后重载）且本地没有未提交修改时，同步草稿。
  // 使用渲染期间调整状态的官方模式，避免 effect 内同步 setState 造成级联渲染。
  const [prevProfile, setPrevProfile] = useState(profile);
  if (prevProfile !== profile) {
    setPrevProfile(profile);
    if (!dirty) {
      setDraftRegions(profile.regions);
      setDraftNature(profile.employmentNaturePreference);
      setPreview({ status: "idle" });
    }
  }

  const persistPreferences = async (
    regions: RegionPreference[],
    nature: EmploymentNaturePreference | undefined,
  ) => {
    const persistLocal = AUTH_MODE !== "invited" || authStatus !== "authenticated";
    if (persistLocal) {
      guestSessionService.save({
        draft: { regions, employmentNaturePreference: nature },
      });
      return;
    }
    await profileApi.saveProfile({
      ...profile,
      regions,
      employmentNaturePreference: nature,
    });
  };

  const runPreview = async () => {
    const seq = ++requestSeq.current;
    setPreview({ status: "loading" });
    setApplyError(null);
    try {
      const draftProfile: UserRecruitmentProfile = {
        ...profile,
        regions: draftRegions,
        employmentNaturePreference: draftNature,
      };
      // 只读预览：显式携带草稿画像，服务端不持久化
      const previewResponse = await opportunitiesApi.match(draftProfile, {
        sendProfile: true,
      });
      if (seq !== requestSeq.current) return; // 已有更新的请求，丢弃本次响应
      if (!isSameCatalog(response.meta, previewResponse.meta)) {
        setPreview({ status: "stale" });
        return;
      }
      const result = buildPreferencePreview(
        buildListViewModel(response, profile),
        buildListViewModel(previewResponse, draftProfile),
      );
      setPreview({ status: "ready", result });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setPreview({
        status: "error",
        message:
          error instanceof Error ? error.message : "暂时无法计算影响预览",
      });
    }
  };

  const apply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const snapshot: UndoSnapshot = {
        regions: profile.regions,
        employmentNaturePreference: profile.employmentNaturePreference,
        savedAt: new Date().toISOString(),
      };
      await persistPreferences(draftRegions, draftNature);
      // 内存态优先：即使持久化快照失败，本会话内撤销条仍可用
      setUndo(snapshot);
      setNotice("已按新的偏好重新计算。原偏好已保留，可在下方撤销。");
      setPreview({ status: "idle" });
      try {
        window.localStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // 存储不可用（隐私模式/超限）：不影响本会话内撤销
      }
      onApplied();
    } catch (error) {
      setApplyError(
        `保存失败，偏好未被修改：${error instanceof Error ? error.message : "请重试"}`,
      );
    } finally {
      setApplying(false);
    }
  };

  const revert = async () => {
    if (!undo) return;
    setApplying(true);
    setApplyError(null);
    try {
      await persistPreferences(undo.regions, undo.employmentNaturePreference);
      try {
        window.localStorage.removeItem(UNDO_STORAGE_KEY);
      } catch {
        // 存储不可用：内存态已清除
      }
      setUndo(null);
      setNotice("已撤销，恢复为之前的偏好。");
      onApplied();
    } catch (error) {
      setApplyError(
        `撤销失败：${error instanceof Error ? error.message : "请重试"}`,
      );
    } finally {
      setApplying(false);
    }
  };

  const cancel = () => {
    requestSeq.current += 1; // 丢弃进行中的预览响应
    setDraftRegions(profile.regions);
    setDraftNature(profile.employmentNaturePreference);
    setPreview({ status: "idle" });
    setApplyError(null);
  };

  return (
    <section
      aria-label="调整偏好与影响预览"
      data-testid="preference-preview-card"
      className="rounded-2xl border border-line bg-surface px-4 py-3.5"
    >
      {notice && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-success-soft px-3 py-2 text-xs leading-5 text-success"
        >
          {notice}
        </p>
      )}
      {undo && (
        <div
          data-testid="preference-undo-bar"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-soft px-3 py-2"
        >
          <p className="text-xs leading-5 text-brand-strong">
            偏好已调整。如果结果不是预期的，可以撤销回之前的偏好。
          </p>
          <button
            type="button"
            onClick={revert}
            disabled={applying}
            className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-brand-strong ring-1 ring-line transition-colors hover:bg-canvas disabled:opacity-50"
          >
            撤销偏好修改
          </button>
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-ink">
          调整偏好（地区级别 / 用工形式）
          <span className="mt-0.5 block text-xs font-normal text-ink-muted">
            保存前先看影响预览：只调整偏好，不改变资格判断；增删地区请走「修改报考信息」。
          </span>
        </span>
        <span aria-hidden="true" className="text-xs text-ink-muted">
          {open ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-line pt-3">
          <div className="space-y-2">
            {draftRegions.map((region, index) => (
              <div
                key={region.code}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
              >
                <span className="text-sm text-ink">
                  {region.city ?? region.province}
                </span>
                <span className="flex gap-1" role="group" aria-label="地区级别">
                  {REGION_LEVEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={region.level === opt.value}
                      title={opt.hint}
                      onClick={() => {
                        const next = draftRegions.slice();
                        next[index] = { ...region, level: opt.value };
                        setDraftRegions(next);
                        setPreview({ status: "idle" });
                      }}
                      className={
                        region.level === opt.value
                          ? "rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white"
                          : "rounded-lg bg-canvas px-2.5 py-1 text-xs text-ink-muted ring-1 ring-line transition-colors hover:bg-brand-soft"
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="text-sm text-ink">用工形式偏好</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="用工形式偏好">
              {NATURE_PREFERENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={draftNature === opt.value}
                  title={opt.hint}
                  onClick={() => {
                    setDraftNature(opt.value);
                    setPreview({ status: "idle" });
                  }}
                  className={
                    draftNature === opt.value
                      ? "rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white"
                      : "rounded-lg bg-canvas px-2.5 py-1 text-xs text-ink-muted ring-1 ring-line transition-colors hover:bg-brand-soft"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {preview.status === "ready" && (
            <div
              data-testid="preference-preview-result"
              className="space-y-2 rounded-xl bg-canvas p-3"
            >
              <p className="text-xs font-semibold text-ink">调整影响预览（未保存）</p>
              {preview.result.unchanged ? (
                <p className="text-xs leading-5 text-ink-muted">
                  按当前目录与你的资料计算，调整后各分组数量不变。
                </p>
              ) : (
                <ul className="space-y-1 text-xs leading-5 text-ink">
                  {preview.result.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {preview.result.newUnitNames.length > 0 && (
                <p className="text-xs leading-5 text-ink-muted">
                  新增进入视野：{preview.result.newUnitNames.join("、")}
                  {preview.result.newUnitNames.length >= 5 ? " 等" : ""}
                </p>
              )}
              <p className="text-xs leading-5 text-ink-muted">
                {preview.result.caliberNote}
              </p>
            </div>
          )}
          {preview.status === "stale" && (
            <p
              data-testid="preference-preview-stale"
              className="rounded-xl bg-warning-soft px-3 py-2 text-xs leading-5 text-ink"
            >
              目录已更新为新版本，本次预览结果已丢弃。请先确认当前列表已是最新，再重新预览。
            </p>
          )}
          {preview.status === "error" && (
            <p
              data-testid="preference-preview-error"
              className="rounded-xl bg-warning-soft px-3 py-2 text-xs leading-5 text-ink"
            >
              暂时无法计算影响预览（{preview.status === "error" ? preview.message : ""}）。
              你的偏好未被修改，可以稍后重试。
            </p>
          )}
          {applyError && (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs leading-5 text-ink">
              {applyError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runPreview}
              disabled={!dirty || preview.status === "loading" || applying}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {preview.status === "loading" ? "正在计算影响…" : "预览影响"}
            </button>
            {preview.status === "ready" && (
              <button
                type="button"
                data-testid="preference-preview-apply"
                onClick={apply}
                disabled={applying}
                className="rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {applying ? "正在保存…" : "确认应用并重新计算"}
              </button>
            )}
            {dirty && (
              <button
                type="button"
                onClick={cancel}
                disabled={applying}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink-muted ring-1 ring-line transition-colors hover:bg-canvas disabled:opacity-50"
              >
                放弃修改
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
