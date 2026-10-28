"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { dimensionLabel } from "@/lib/ia/labels";
import {
  CITY_OPTIONS,
  PROVINCE_OPTIONS,
} from "@/lib/guest/guestSession";
import type { DimensionDTO } from "@/lib/opportunities/api-types";
import type { SupplementFacts } from "@/lib/profile/activeProfile";

interface SupplementFormProps {
  /** 详情中待确认（UNKNOWN / MANUAL_REVIEW）的条件 */
  dimensions: DimensionDTO[];
  initial: SupplementFacts;
  saving: boolean;
  onSave: (facts: SupplementFacts) => void;
  /**
   * D05「影响岗位」：各待补维度影响的机会数（含本岗位，后端分组计数）。
   * null/缺省时只显示公告要求，不显示数量（请求失败不编造）。
   */
  impact?: Partial<Record<DimensionDTO["dimension"], number>> | null;
}

interface FormState {
  birthDate: string;
  hukouProvinceCode: string;
  hukouCityCode: string;
  socialSecurityMonths: string;
  workExperienceMonths: string;
  extraAnswers: Record<string, string>;
}

function toFormState(facts: SupplementFacts): FormState {
  return {
    birthDate: facts.birthDate ?? "",
    hukouProvinceCode: facts.hukouProvinceCode ?? "",
    hukouCityCode: facts.hukouCityCode ?? "",
    socialSecurityMonths:
      facts.socialSecurityMonths === undefined
        ? ""
        : String(facts.socialSecurityMonths),
    workExperienceMonths:
      facts.workExperienceMonths === undefined
        ? ""
        : String(facts.workExperienceMonths),
    extraAnswers: { ...(facts.extraAnswers ?? {}) },
  };
}

/**
 * 按需补问表单：只展示当前机会确实需要的条件。
 * MANUAL_REVIEW 条件不在此收集——它们必须向招聘单位人工确认，
 * 任何用户输入都不会把歧义条件自动改成符合。
 */
export function SupplementForm({
  dimensions,
  initial,
  saving,
  onSave,
  impact,
}: SupplementFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial));

  const unknownDims = dimensions.filter((d) => d.value === "UNKNOWN");
  const manualDims = dimensions.filter((d) => d.value === "MANUAL_REVIEW");
  const has = (kind: DimensionDTO["dimension"]) =>
    unknownDims.some((d) => d.dimension === kind);
  const otherDims = unknownDims.filter((d) => d.dimension === "other");

  /** D05：该项条件的公告要求原文 + 影响岗位数（PRD 11.6 补充提示三要素中的两项） */
  const requirementNote = (kind: DimensionDTO["dimension"]) => {
    const d = unknownDims.find((item) => item.dimension === kind);
    if (!d) return null;
    const requirement = d.requirementDescription ?? d.reason;
    const affected = impact?.[kind];
    return (
      <p className="mb-1.5 text-[11px] leading-4 text-ink-muted">
        {requirement ? `公告要求：${requirement}` : null}
        {affected
          ? `${requirement ? " · " : ""}补充这项会影响 ${affected} 个机会的判断（含本岗位）`
          : ""}
      </p>
    );
  };

  const cities = form.hukouProvinceCode
    ? (CITY_OPTIONS[form.hukouProvinceCode] ?? [])
    : [];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const facts: SupplementFacts = {
      birthDate: form.birthDate || undefined,
      hukouProvinceCode: form.hukouProvinceCode || undefined,
      hukouCityCode: form.hukouCityCode || undefined,
      socialSecurityMonths:
        form.socialSecurityMonths === ""
          ? undefined
          : Number(form.socialSecurityMonths),
      workExperienceMonths:
        form.workExperienceMonths === ""
          ? undefined
          : Number(form.workExperienceMonths),
      extraAnswers:
        Object.keys(form.extraAnswers).length > 0
          ? form.extraAnswers
          : undefined,
    };
    onSave(facts);
  };

  if (unknownDims.length === 0 && manualDims.length === 0) return null;

  return (
    <section className="space-y-4 rounded-xl border border-warn/30 bg-warn-soft/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          补充信息后重新判断
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          以下信息只在需要时按机会补问；留空表示暂不提供，该条件会继续保持“待确认”，
          不会被判定为不符合。保存后会立即根据新信息重新判断。
        </p>
      </div>

      {manualDims.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-surface p-3">
          <p className="text-xs font-semibold text-warn">
            需向招聘单位人工确认（补充资料不能替代确认）
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-xs text-ink-muted">
            {manualDims.map((d) => (
              <li key={d.requirementId}>
                {dimensionLabel(d.dimension)}：{d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {has("age") && (
        <div>
          {requirementNote("age")}
          <Input
            type="date"
            label="出生日期"
            value={form.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
          />
        </div>
      )}

      {has("hukou") && (
        <div>
          {requirementNote("hukou")}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="户籍所在省"
              placeholder="选择省份"
              options={PROVINCE_OPTIONS.map((p) => ({
                value: p.code,
                label: p.name,
              }))}
              value={form.hukouProvinceCode}
              onChange={(e) => {
                // 切省后清空不匹配的市
                setForm((prev) => ({
                  ...prev,
                  hukouProvinceCode: e.target.value,
                  hukouCityCode: "",
                }));
              }}
            />
            <Select
              label="户籍所在市（有市选市，判定更精确）"
              placeholder={cities.length > 0 ? "选择城市或选全省" : "该省请选全省均可"}
              options={[
                ...cities.map((c) => ({ value: c.code, label: c.name })),
              ]}
              value={form.hukouCityCode}
              onChange={(e) => set("hukouCityCode", e.target.value)}
              disabled={cities.length === 0}
            />
          </div>
        </div>
      )}

      {has("social_security") && (
        <div>
          {requirementNote("social_security")}
          <Input
            type="number"
            min={0}
            step={1}
            label="社保累计缴纳月数"
            hint="没有社保记录请填 0；不确定可留空，保持待确认。"
            value={form.socialSecurityMonths}
            onChange={(e) => set("socialSecurityMonths", e.target.value)}
          />
        </div>
      )}

      {has("work_experience") && (
        <div>
          {requirementNote("work_experience")}
          <Input
            type="number"
            min={0}
            step={1}
            label="相关工作经历月数"
            value={form.workExperienceMonths}
            onChange={(e) => set("workExperienceMonths", e.target.value)}
          />
        </div>
      )}

      {otherDims.map((d) => (
        <div key={d.requirementId}>
          <Textarea
            label={d.requirementDescription || dimensionLabel(d.dimension)}
            value={form.extraAnswers[d.requirementId] ?? ""}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                extraAnswers: {
                  ...prev.extraAnswers,
                  [d.requirementId]: e.target.value,
                },
              }))
            }
          />
          <p className="mt-1 text-sm text-ink-muted">{d.reason}</p>
        </div>
      ))}

      {unknownDims.length > 0 && (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? "保存并重新计算中…" : "保存并重新判断"}
          </Button>
          <span className="text-[11px] text-ink-muted">
            信息只用于资格匹配，不会发送给招聘单位。
          </span>
        </div>
      )}
    </section>
  );
}
