"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { opportunitiesApi } from "@/lib/opportunities/api";
import type {
  SubscriptionDTO,
  SubscriptionRegionDTO,
  SubscriptionUpdateInput,
} from "@/lib/opportunities/api-types";
import { stageLabel, subjectLabel } from "@/lib/ia/labels";
import type { UserRecruitmentProfile } from "@/lib/profile/types";
import { useCurrentUser } from "@/lib/auth";

type NaturePreference = SubscriptionDTO["naturePreference"];

const NATURE_PREFERENCE_LABELS: Record<NaturePreference, string> = {
  public_only: "只要事业编岗位",
  official_open: "事业编及各类官方用工（备案制、员额制等）",
  undecided: "用工性质尚未确定（都提醒）",
};

const DEGREE_LABELS: Record<string, string> = {
  none: "不限",
  bachelor: "本科",
  master: "硕士",
  doctorate: "博士",
};

function regionDtoLabel(region: SubscriptionRegionDTO): string {
  return region.district ?? region.city ?? region.province;
}

/** 与后端 deriveSubscriptionCriteria / demo 派生同口径的用工偏好预览 */
function deriveDefaultNature(profile: UserRecruitmentProfile): NaturePreference {
  const accepted = profile.acceptedEmploymentNatures ?? [];
  if (accepted.length === 0) return "undecided";
  if (
    accepted.length === 1 &&
    accepted[0] === "public_institution_staff"
  ) {
    return "public_only";
  }
  return "official_open";
}

function profileRegionsToDto(
  profile: UserRecruitmentProfile,
): SubscriptionRegionDTO[] {
  return (profile.regions ?? []).map((r) => ({
    code: r.code,
    province: r.province,
    ...(r.city ? { city: r.city } : {}),
    ...(r.district ? { district: r.district } : {}),
  }));
}

/**
 * 新机会订阅卡片（v7.1 M6）：
 * - 未订阅：展示默认条件（地区、语文学科、用工偏好、必要资格条件），一键开启；
 * - 已订阅：可查看条件、修改地区与用工偏好、关闭/重新开启；
 * - 渠道边界固定文案：只站内提醒，不宣称邮件/短信/微信/系统级实时推送；
 *   同一公告同一发布版本只提醒一次；关闭后停止新提醒，历史通知保留。
 */
export function SubscriptionCard({
  profile,
}: {
  profile: UserRecruitmentProfile;
}) {
  const router = useRouter();
  const { status: authStatus } = useCurrentUser();
  const [sub, setSub] = useState<SubscriptionDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftRegions, setDraftRegions] = useState<SubscriptionRegionDTO[]>([]);
  const [draftNature, setDraftNature] = useState<NaturePreference>("undecided");
  // v7.1 M8：登录后继续订阅动作
  const [pendingSubscribe] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("kb_pending_subscribe") === "1";
  });

  useEffect(() => {
    let cancelled = false;
    opportunitiesApi
      .getSubscription()
      .then((row) => {
        if (!cancelled) setSub(row);
        // v7.1 M8：登录后继续订阅动作——读取到无订阅且有待定标记时自动开启
        if (!cancelled && !row && pendingSubscribe && authStatus === "authenticated") {
          window.sessionStorage.removeItem("kb_pending_subscribe");
          setSub(null);
          void run(() => upsert({}));
        }
      })
      .catch(() => {
        // 读取失败保持未订阅视图，不阻塞机会页
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, pendingSubscribe]);

  /** 可勾选地区 = 订阅当前地区 ∪ 画像地区（均来自用户已填信息，不猜测新地区） */
  const regionOptions = useMemo(() => {
    const byCode = new Map<string, SubscriptionRegionDTO>();
    for (const region of [
      ...(sub?.regions ?? []),
      ...profileRegionsToDto(profile),
    ]) {
      if (!byCode.has(region.code)) byCode.set(region.code, region);
    }
    return [...byCode.values()];
  }, [sub, profile]);

  const defaultRegionLabels = useMemo(() => {
    const fromProfile = profileRegionsToDto(profile);
    if (fromProfile.length === 0) return null;
    return fromProfile.map(regionDtoLabel).join("、");
  }, [profile]);

  async function run(action: () => Promise<SubscriptionDTO>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSub(await action());
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }

  function upsert(input: SubscriptionUpdateInput): Promise<SubscriptionDTO> {
    return opportunitiesApi.upsertSubscription(input);
  }

  function startEditing(): void {
    if (!sub) return;
    setDraftRegions(sub.regions);
    setDraftNature(sub.naturePreference);
    setEditing(true);
  }

  function toggleDraftRegion(region: SubscriptionRegionDTO): void {
    setDraftRegions((current) =>
      current.some((r) => r.code === region.code)
        ? current.filter((r) => r.code !== region.code)
        : [...current, region],
    );
  }

  return (
    <section
      id="subscription"
      aria-labelledby="subscription-heading"
      className="scroll-mt-20 rounded-2xl border border-line bg-surface p-4"
      data-testid="subscription-card"
    >
      <h2 id="subscription-heading" className="text-sm font-semibold text-ink">
        新机会提醒订阅
      </h2>

      {!loaded ? (
        <p className="mt-2 text-xs text-ink-muted">订阅信息加载中…</p>
      ) : sub === null ? (
        <div className="mt-2" data-testid="subscription-preview">
          <p className="text-xs leading-5 text-ink-muted">
            开启后默认按以下条件匹配，出现符合的公告时在站内提醒你：
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted">
            <li>
              · 报考地区：
              {defaultRegionLabels ?? "你在报考信息中填写的地区"}
            </li>
            <li>· 学科：语文（当前唯一开放学科）</li>
            <li>· 用工偏好：{NATURE_PREFERENCE_LABELS[deriveDefaultNature(profile)]}</li>
            <li>· 资格条件：以你保存的学历、毕业时间与教师资格为必要条件</li>
          </ul>
          <div className="mt-3">
            <Button
              size="sm"
              loading={busy}
              onClick={() => {
                // v7.1 M8：未登录用户开启订阅触发登录
                if (authStatus !== "authenticated") {
                  window.sessionStorage.setItem("kb_pending_subscribe", "1");
                  router.push("/login?next=/opportunities&reason=subscribe");
                  return;
                }
                run(() => upsert({}));
              }}
              data-testid="subscription-enable"
            >
              开启订阅
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2" data-testid="subscription-active">
          <p className="text-xs leading-5 text-ink-muted">
            当前状态：
            <span
              className={
                sub.enabled
                  ? "font-semibold text-success"
                  : "font-semibold text-ink"
              }
            >
              {sub.enabled ? "已开启" : "已关闭（停止新提醒，历史通知保留）"}
            </span>
          </p>

          {!editing ? (
            <>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted" data-testid="subscription-criteria">
                <li>
                  · 报考地区：
                  {sub.regions.length > 0
                    ? sub.regions.map(regionDtoLabel).join("、")
                    : "未设置"}
                </li>
                <li>· 学科：{subjectLabel("chinese")}</li>
                <li>· 用工偏好：{NATURE_PREFERENCE_LABELS[sub.naturePreference]}</li>
                {sub.qualification && (
                  <li>
                    · 资格条件：
                    {[
                      sub.qualification.degree
                        ? DEGREE_LABELS[sub.qualification.degree] ??
                          sub.qualification.degree
                        : null,
                      sub.qualification.graduationDate,
                      sub.qualification.certSubject
                        ? `${subjectLabel(sub.qualification.certSubject as never)}教师资格`
                        : null,
                      sub.qualification.certStage
                        ? `${stageLabel(sub.qualification.certStage as never)}学段`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={startEditing}>
                  修改条件
                </Button>
                {sub.enabled ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    onClick={() => run(() => upsert({ enabled: false }))}
                    data-testid="subscription-disable"
                  >
                    关闭订阅
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() => run(() => upsert({ enabled: true }))}
                    data-testid="subscription-reenable"
                  >
                    重新开启
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-3" data-testid="subscription-editor">
              <fieldset>
                <legend className="text-xs font-semibold text-ink">
                  报考地区
                </legend>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {regionOptions.length === 0 ? (
                    <p className="text-xs text-ink-muted">
                      暂无可选地区，请先在报考信息中填写地区。
                    </p>
                  ) : (
                    regionOptions.map((region) => {
                      const checked = draftRegions.some(
                        (r) => r.code === region.code,
                      );
                      return (
                        <label
                          key={region.code}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1 text-xs text-ink has-checked:border-brand has-checked:bg-brand-soft"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftRegion(region)}
                            className="h-3.5 w-3.5 accent-brand"
                          />
                          {regionDtoLabel(region)}
                        </label>
                      );
                    })
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold text-ink">
                  用工偏好
                </legend>
                <div className="mt-1.5 space-y-1.5">
                  {(Object.keys(NATURE_PREFERENCE_LABELS) as NaturePreference[]).map(
                    (code) => (
                      <label
                        key={code}
                        className="flex cursor-pointer items-center gap-2 text-xs text-ink"
                      >
                        <input
                          type="radio"
                          name="subscription-nature"
                          checked={draftNature === code}
                          onChange={() => setDraftNature(code)}
                          className="h-3.5 w-3.5 accent-brand"
                        />
                        {NATURE_PREFERENCE_LABELS[code]}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    run(() =>
                      upsert({
                        regions: draftRegions,
                        naturePreference: draftNature,
                      }),
                    )
                  }
                  data-testid="subscription-save"
                >
                  保存修改
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      <p className="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-muted">
        提醒只出现在站内通知中心与导航未读数，不发送邮件、短信或微信，也不是系统级实时推送。
        只有官方来源、未过期、已人工核对、地区与学科相符且没有已知明确不符合项的公告才会触发提醒；
        同一公告的同一发布版本只提醒一次。关闭订阅后停止新提醒，历史通知保留。
      </p>
    </section>
  );
}
