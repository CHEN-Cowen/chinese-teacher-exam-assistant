"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { AUTH_MODE, useCurrentUser } from "@/lib/auth";
import { buildActiveProfile } from "@/lib/profile/activeProfile";
import { profileApi } from "@/lib/profile/profileApi";
import { educationExperiencesService, EDUCATION_UPDATED_EVENT } from "@/lib/profile/educationStore";
import {
  confirmLegacyStage,
  createEducationExperience,
  DEGREE_STATUS_LABELS,
  describeEducationExperience,
  EDUCATION_STAGE_LABELS,
  EDUCATION_STAGE_ORDER,
  EDUCATION_STATUS_LABELS,
  nextEducationStage,
  normalizeEducationExperiences,
  STUDY_MODE_LABELS,
  TEACHER_TRAINING_LABELS,
  validateEducationExperiences,
  type EducationExperience,
} from "@/lib/profile/education";
import { migrateEducationProfile } from "@/lib/profile/education";
import type {
  EducationDegreeStatus,
  EducationStage,
  EducationStatus,
  EducationStudyMode,
  TeacherTraining,
  UserRecruitmentProfile,
} from "@/lib/profile/types";
import { DEGREE_OPTIONS } from "@/lib/guest/guestSession";

const AUTH_MODE_INVITED = AUTH_MODE === "invited";

const FIELD_CLASS =
  "mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink transition-colors hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `edu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 分阶段教育经历（D01）。
 *
 * - 本科/硕士等阶段分别记录专业，公告按阶段要求时能说明采用了哪一段；
 * - 旧单一字段迁移记录需用户确认阶段归属，确认只改归属不改原值；
 * - demo/访客保存到本机，invited 已登录保存到服务端画像；
 * - 保存失败保留页面输入并提示，不静默丢失。
 */
export default function EducationPage() {
  const { status: authStatus } = useCurrentUser();
  const authenticated = AUTH_MODE_INVITED && authStatus === "authenticated";
  const [profile, setProfile] = useState<UserRecruitmentProfile | null>(null);
  const [experiences, setExperiences] = useState<EducationExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState<Record<string, EducationStage>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** R01：读取失败时禁止保存，避免把“没读到”当成“没有画像”继续覆盖 */
  const [loadFailed, setLoadFailed] = useState(false);
  /** R01：本机登录前填写的分阶段经历（服务端已登录时用于明确的导入确认） */
  const [localExperiences, setLocalExperiences] = useState<EducationExperience[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  /** R01：409 冲突提示（保留页面输入） */
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  /** 服务端经历与页面输入是否不同（用于冲突导入确认） */
  const differsFromLocal = useMemo(() => {
    if (localExperiences.length === 0) return false;
    return (
      JSON.stringify(normalizeEducationExperiences(experiences)) !==
      JSON.stringify(normalizeEducationExperiences(localExperiences))
    );
  }, [experiences, localExperiences]);

  useEffect(() => {
    let cancelled = false;
    const nowIso = new Date().toISOString();

    /** 已登录：服务端经历为准；本机经历只作为导入提示，绝不自动替换 */
    const applyServer = (
      base: UserRecruitmentProfile,
      metaUpdatedAt: string | undefined,
    ) => {
      if (cancelled) return;
      const local = educationExperiencesService.load();
      setLocalExperiences(local);
      setProfile(base);
      setSavedAt(metaUpdatedAt ?? null);
      setLoadFailed(false);
      const serverExperiences = normalizeEducationExperiences(
        base.educationExperiences,
      );
      if (serverExperiences.length > 0) {
        setExperiences(serverExperiences);
      } else if (base.legacyEducation?.confirmed === true) {
        // 用户已明确确认/清空旧字段，不再悄悄恢复旧单一字段
        setExperiences([]);
      } else {
        const seeded = migrateEducationProfile(base, nowIso).profile;
        setExperiences(normalizeEducationExperiences(seeded.educationExperiences));
      }
      setLoading(false);
    };

    /** 访客 / demo：本机经历（登录前填写的数据仍可用） */
    const applyLocal = (base: UserRecruitmentProfile | null) => {
      if (cancelled) return;
      const local = educationExperiencesService.load();
      const source: UserRecruitmentProfile = base ?? {
        regions: [],
        acceptedEmploymentNatures: [],
      };
      const seeded =
        local.length > 0
          ? { ...source, educationExperiences: local }
          : source.legacyEducation?.confirmed === true
            ? source
            : migrateEducationProfile(source, nowIso).profile;
      setLocalExperiences(local);
      setProfile(seeded);
      setExperiences(normalizeEducationExperiences(seeded.educationExperiences));
      setLoading(false);
    };

    if (authenticated) {
      profileApi
        .getProfileWithMeta()
        .then((row) => {
          if (cancelled) return;
          applyServer(
            row.profile ?? { regions: [], acceptedEmploymentNatures: [] },
            row.updatedAt,
          );
        })
        .catch(() => {
          if (cancelled) return;
          setLoadFailed(true);
          setError("读取报考信息失败，请稍后重试；本页不会覆盖已有资料。");
          setLoading(false);
        });
    } else if (!AUTH_MODE_INVITED || authStatus !== "loading") {
      const active = buildActiveProfile();
      applyLocal(active.ready ? active.profile : null);
    }

    return () => {
      cancelled = true;
    };
  }, [authenticated, authStatus]);


  useEffect(() => {
    // 其他页面修改后回到本页时刷新（仅本机来源）
    const handler = () => {
      if (!authenticated) setExperiences(educationExperiencesService.load());
    };
    window.addEventListener(EDUCATION_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EDUCATION_UPDATED_EVENT, handler);
  }, [authenticated]);

  const pendingConfirmations = useMemo(
    () => experiences.filter((item) => item.stageNeedsConfirmation),
    [experiences],
  );

  const update = (id: string, patch: Partial<EducationExperience>) => {
    setSaved(false);
    setExperiences((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const remove = (id: string) => {
    setSaved(false);
    setExperiences((prev) => prev.filter((item) => item.id !== id));
  };

  const add = () => {
    setSaved(false);
    setExperiences((prev) => {
      const stage = nextEducationStage(prev);
      return [...prev, createEducationExperience(stage, newId())];
    });
  };

  const confirm = (item: EducationExperience) => {
    const stage = confirmStage[item.id] ?? item.stage;
    if (!stage) return;
    if (profile) {
      setProfile(confirmLegacyStage(profile, item.id, stage, new Date().toISOString()));
    }
    update(item.id, {
      stage,
      stageNeedsConfirmation: false,
      majorConfirmed: true,
    });
  };

  const legacyConfirmation = useMemo(
    () => ({
      confirmed: pendingConfirmations.length === 0,
      ...(pendingConfirmations.length === 0
        ? { confirmedAt: new Date().toISOString() }
        : {}),
    }),
    [pendingConfirmations.length],
  );

  const save = async () => {
    const issues = validateEducationExperiences(experiences);
    if (issues.length > 0) {
      setError(issues[0].message);
      return;
    }
    if (authenticated && loadFailed) {
      setError("当前没能读取到账号资料，为避免覆盖已有经历，暂不能保存。请刷新后重试。");
      return;
    }
    setError(null);
    setConflictNotice(null);
    setSaving(true);
    const normalized = normalizeEducationExperiences(experiences);
    try {
      if (authenticated) {
        // R01：只提交教育字段 + 期望版本，不把整份旧画像 PUT 回去
        const row = await profileApi.patchProfile(
          {
            educationExperiences: normalized,
            legacyEducation: legacyConfirmation,
          },
          savedAt ?? undefined,
        );
        setProfile((prev) => ({
          ...(prev ?? { regions: [], acceptedEmploymentNatures: [] }),
          educationExperiences: normalized,
          legacyEducation: legacyConfirmation,
        }));
        setSavedAt(row.updatedAt ?? savedAt);
      } else {
        educationExperiencesService.save(normalized);
        setSavedAt(new Date().toISOString());
      }
      setSaved(true);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        // 冲突：拉取最新版本更新版本号，但保留用户当前输入
        await profileApi
          .getProfileWithMeta()
          .then((row) => setSavedAt(row.updatedAt ?? null))
          .catch(() => undefined);
        setConflictNotice(
          "账号资料已在其他设备更新。已为你载入最新版本号，页面上你正在编辑的内容仍保留；请核对后再次保存。",
        );
      } else {
        setError(
          e instanceof Error
            ? `保存失败：${e.message}。页面内容仍保留，可重试。`
            : "保存失败，页面内容仍保留，可重试。",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  /** R01：把本机登录前填写的经历导入账号（明确确认后才写入服务端） */
  const importLocalExperiences = async (useLocal: boolean) => {
    if (!authenticated) return;
    setImportBusy(true);
    setError(null);
    try {
      if (!useLocal) {
        educationExperiencesService.clear();
        setLocalExperiences([]);
        setImportNotice("已保留账号内的教育经历，本机草稿未导入。");
        return;
      }
      const normalized = normalizeEducationExperiences(localExperiences);
      const row = await profileApi.patchProfile(
        {
          educationExperiences: normalized,
          legacyEducation: {
            confirmed: !normalized.some((item) => item.stageNeedsConfirmation),
            ...(normalized.some((item) => item.stageNeedsConfirmation)
              ? {}
              : { confirmedAt: new Date().toISOString() }),
          },
        },
        savedAt ?? undefined,
      );
      setSavedAt(row.updatedAt ?? savedAt);
      setExperiences(normalized);
      setProfile((prev) => ({
        ...(prev ?? { regions: [], acceptedEmploymentNatures: [] }),
        educationExperiences: normalized,
      }));
      educationExperiencesService.clear();
      setLocalExperiences([]);
      setImportNotice("已导入本机教育经历并保存到账号。");
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 409
          ? "账号资料刚在其他设备更新，导入未完成。请刷新页面后重试。"
          : "导入失败，本机草稿仍保留，可重试。",
      );
    } finally {
      setImportBusy(false);
    }
  };

  if ((AUTH_MODE_INVITED && authStatus === "loading") || loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-sm text-ink-muted">正在读取教育经历…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-5 sm:px-6">
      <div>
        <Link
          href="/me"
          className="inline-flex min-h-10 items-center text-sm text-ink-muted hover:text-ink"
        >
          ‹ 返回我的
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          教育经历
        </h1>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          按学历阶段分别填写毕业证专业。公告要求本科专业或要求多个阶段同时满足时，
          系统才能说明采用了哪一段经历。
        </p>
      </div>

      {loadFailed && (
        <Card className="border-danger/30 bg-danger-soft/40">
          <p className="text-sm font-semibold text-danger">没能读取账号里的教育经历</p>
          <p className="mt-1 text-xs leading-5 text-danger">
            这不等同于“没有教育经历”。为避免覆盖账号已有资料，本页暂不保存。
            请刷新页面或稍后重试。
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              重新读取
            </Button>
          </div>
        </Card>
      )}

      {authenticated && localExperiences.length > 0 && (
        <Card className="border-brand/30 bg-brand-soft/40">
          <p className="text-sm font-semibold text-ink">
            {experiences.length === 0
              ? "本机还有登录前填写的教育经历"
              : differsFromLocal
                ? "本机草稿与账号里保存的经历不一致"
                : "本机草稿与账号里保存的经历一致"}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {experiences.length === 0
              ? "系统没有自动写入账号。你可以先核对下面的本机内容，再决定是否导入。"
              : "账号内的经历优先显示。是否用本机草稿覆盖账号内容，由你确认。"}
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted">
            {localExperiences.map((item) => (
              <li key={`local-${item.id}`}>本机：{describeEducationExperience(item)}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => importLocalExperiences(true)}
              disabled={importBusy}
            >
              {importBusy ? "处理中…" : experiences.length === 0 ? "导入到账号" : "用本机草稿覆盖账号"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => importLocalExperiences(false)}
              disabled={importBusy}
            >
              不使用本机草稿
            </Button>
          </div>
        </Card>
      )}

      {importNotice && (
        <p className="rounded-lg bg-success-soft/60 px-3 py-2 text-xs text-success">
          {importNotice}
        </p>
      )}

      {conflictNotice && (
        <Card className="border-warn/30 bg-warn-soft/40">
          <p className="text-sm font-semibold text-warn">保存时发现版本冲突</p>
          <p className="mt-1 text-xs leading-5 text-warn">{conflictNotice}</p>
        </Card>
      )}

      {pendingConfirmations.length > 0 && (
        <Card className="border-warn/30 bg-warn-soft/40">
          <p className="text-sm font-semibold text-warn">旧资料需要确认一次</p>
          <p className="mt-1 text-xs leading-5 text-warn">
            以下内容来自你之前填写的单一学历字段，系统没有改动原值。
            请确认它属于哪个阶段，确认后才会用于匹配判断。
          </p>
          <div className="mt-3 space-y-3">
            {pendingConfirmations.map((item) => (
              <div key={item.id} className="rounded-lg border border-warn/30 bg-surface p-3">
                <p className="text-sm text-ink">{describeEducationExperience(item)}</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="min-w-[10rem] flex-1">
                    <span className="text-xs text-ink-muted">这条经历属于</span>
                    <select
                      value={confirmStage[item.id] ?? item.stage ?? ""}
                      onChange={(e) =>
                        setConfirmStage((prev) => ({
                          ...prev,
                          [item.id]: e.target.value as EducationStage,
                        }))
                      }
                      className={FIELD_CLASS}
                    >
                      <option value="" disabled>
                        请选择阶段
                      </option>
                      {EDUCATION_STAGE_ORDER.map((stage) => (
                        <option key={stage} value={stage}>
                          {EDUCATION_STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => confirm(item)}
                    disabled={!(confirmStage[item.id] ?? item.stage)}
                  >
                    确认归属
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {experiences.length === 0 && (
        <Card>
          <p className="text-sm text-ink">还没有分阶段的教育经历。</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            添加后，系统会按最高学历判断门槛，并在专业条件中逐段比对。
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {experiences.map((item, index) => (
          <EducationCard
            key={item.id}
            experience={item}
            index={index}
            onUpdate={(patch) => update(item.id, patch)}
            onRemove={experiences.length > 1 ? () => remove(item.id) : undefined}
          />
        ))}
      </div>

      <Button variant="outline" onClick={add} fullWidth disabled={!nextEducationStage(experiences)}>
        + 添加一个学历阶段
      </Button>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}

      {saved && (
        <div className="rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-sm text-success">
          已保存{savedAt ? `（${new Date(savedAt).toLocaleString("zh-CN")}）` : ""}。
          {authenticated ? "筛选结果将在下次打开时按新经历重新计算。" : "登录后会同步到你的账号。"}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => void save()} loading={saving} size="lg" fullWidth>
          保存教育经历
        </Button>
        <Link
          href="/opportunities"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium text-ink hover:border-brand/30"
        >
          去看筛选结果
        </Link>
      </div>

      <p className="text-center text-xs leading-5 text-ink-muted">
        未填写的字段只会得到“信息不足”，不会被当作不符合。师范背景按阶段记录，
        不跨阶段推断。
      </p>
    </div>
  );
}

function EducationCard({
  experience,
  index,
  onUpdate,
  onRemove,
}: {
  experience: EducationExperience;
  index: number;
  onUpdate: (patch: Partial<EducationExperience>) => void;
  onRemove?: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {experience.stage ? EDUCATION_STAGE_LABELS[experience.stage] : `第 ${index + 1} 段经历`}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {experience.source === "legacy" ? "从旧资料迁移" : "你填写的经历"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {experience.majorConfirmed && experience.stage && (
            <Badge variant="success">已确认</Badge>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-xs text-ink-muted hover:text-danger"
            >
              删除
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink-muted">学历阶段</span>
          <select
            value={experience.stage ?? ""}
            onChange={(e) => onUpdate({ stage: (e.target.value || undefined) as EducationStage })}
            className={FIELD_CLASS}
          >
            <option value="" disabled>
              请选择阶段
            </option>
            {EDUCATION_STAGE_ORDER.map((stage) => (
              <option key={stage} value={stage}>
                {EDUCATION_STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">毕业时间（或预计）</span>
          <input
            type="month"
            value={experience.graduationDate?.slice(0, 7) ?? ""}
            onChange={(e) =>
              onUpdate({
                graduationDate: e.target.value ? `${e.target.value}-15` : undefined,
              })
            }
            className={FIELD_CLASS}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">学校名称（可选）</span>
          <input
            value={experience.schoolName ?? ""}
            onChange={(e) => onUpdate({ schoolName: e.target.value })}
            placeholder="与毕业证一致"
            className={FIELD_CLASS}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">毕业证专业全称</span>
          <input
            value={experience.majorFullName}
            onChange={(e) =>
              onUpdate({ majorFullName: e.target.value, majorConfirmed: false })
            }
            placeholder="例如：汉语言文学（师范）"
            className={FIELD_CLASS}
          />
          <span className="mt-1 block text-xs leading-5 text-ink-muted">
            请保持毕业证原文，括号中的方向不要省略。
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">就读状态</span>
          <select
            value={experience.status ?? ""}
            onChange={(e) =>
              onUpdate({ status: (e.target.value || undefined) as EducationStatus })
            }
            className={FIELD_CLASS}
          >
            <option value="">未填写</option>
            {Object.entries(EDUCATION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">学习形式</span>
          <select
            value={experience.studyMode ?? ""}
            onChange={(e) =>
              onUpdate({
                studyMode: (e.target.value || undefined) as EducationStudyMode,
              })
            }
            className={FIELD_CLASS}
          >
            <option value="">未填写</option>
            {Object.entries(STUDY_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">学位</span>
          <select
            value={experience.degree ?? ""}
            onChange={(e) =>
              onUpdate({
                degree: (e.target.value || undefined) as EducationExperience["degree"],
                degreeStatus: e.target.value
                  ? experience.degreeStatus ?? "obtained"
                  : undefined,
              })
            }
            className={FIELD_CLASS}
          >
            <option value="">未填写</option>
            {DEGREE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-muted">学位状态</span>
          <select
            value={experience.degreeStatus ?? ""}
            onChange={(e) =>
              onUpdate({
                degreeStatus: (e.target.value || undefined) as EducationDegreeStatus,
              })
            }
            className={FIELD_CLASS}
            disabled={!experience.degree}
          >
            <option value="">未填写</option>
            {Object.entries(DEGREE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="m-0 border-0 p-0 sm:col-span-2">
          <legend className="text-xs font-medium text-ink-muted">这一阶段的师范背景</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-2" role="group">
            {(Object.keys(TEACHER_TRAINING_LABELS) as TeacherTraining[]).map((value) => {
              const selected = experience.teacherTraining === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onUpdate({ teacherTraining: value })}
                  className={`min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors ${
                    selected
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-line bg-surface text-ink-muted hover:border-brand/30"
                  }`}
                >
                  {TEACHER_TRAINING_LABELS[value]}
                </button>
              );
            })}
          </div>
          <span className="mt-1 block text-xs leading-5 text-ink-muted">
            只在当前阶段生效，不会推断其他阶段；专业名含“师范”时可填写原文说明。
          </span>
          <input
            value={experience.teacherTrainingNote ?? ""}
            onChange={(e) => onUpdate({ teacherTrainingNote: e.target.value })}
            placeholder="例如：毕业证专业为“汉语言文学（师范）”"
            className={FIELD_CLASS}
          />
        </fieldset>
      </div>
    </Card>
  );
}
