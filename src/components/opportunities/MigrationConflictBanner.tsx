"use client";

import { useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Button } from "@/components/ui/Button";
import { profileApi } from "@/lib/profile/profileApi";
import type { ProfilePatch } from "@/lib/profile/profileRepository";
import {
  supplementFactsService,
  type SupplementFacts,
} from "@/lib/profile/activeProfile";

export interface MigrationConflictBannerProps {
  /** 冲突时访客本机的补充事实（可能缺失，缺失时只允许保留服务端） */
  guestFacts: SupplementFacts | undefined;
  /** 用户作出选择并处理完成后的回调 */
  onResolved: (choice: "guest" | "server") => void;
}

/** 只把白名单字段带入 PATCH */
function toPatch(facts: SupplementFacts): ProfilePatch {
  const patch: ProfilePatch = {};
  if (facts.birthDate !== undefined) patch.birthDate = facts.birthDate;
  if (facts.hukouProvinceCode !== undefined)
    patch.hukouProvinceCode = facts.hukouProvinceCode;
  if (facts.hukouCityCode !== undefined) patch.hukouCityCode = facts.hukouCityCode;
  if (facts.socialSecurityMonths !== undefined)
    patch.socialSecurityMonths = facts.socialSecurityMonths;
  if (facts.workExperienceMonths !== undefined)
    patch.workExperienceMonths = facts.workExperienceMonths;
  if (facts.extraAnswers !== undefined) patch.extraAnswers = facts.extraAnswers;
  return patch;
}

/**
 * v7.2 登录迁移冲突确认横幅（PRD 7.6：冲突要求用户确认，不静默覆盖）。
 *
 * 场景：访客期间在本机补充过条件事实（出生日期/户籍/社保等），登录时发现
 * 账号在服务端也保存过不同的补充信息。用户二选一：
 * - 「使用本次填写的信息」：以最新 updatedAt 乐观锁 PATCH 合并进服务端；
 *   409（其他设备刚更新）时提示重试，不清空用户选择；
 * - 「保留已保存的信息」：清除本机访客补充事实（避免下次登录再次冲突），
 *   服务端画像保持不变。
 * 访客基础草稿（地区/学历/专业/教资）两种选择下都不动。
 */
export function MigrationConflictBanner({
  guestFacts,
  onResolved,
}: MigrationConflictBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUseGuest = async () => {
    if (busy || !guestFacts) return;
    setBusy(true);
    setError(null);
    try {
      // 每次点击都重取最新 updatedAt，保证 409 后重试也能成功
      const { updatedAt } = await profileApi.getProfileWithMeta();
      await profileApi.patchProfile(toPatch(guestFacts), updatedAt);
      onResolved("guest");
    } catch (e) {
      const status = (e as { status?: number })?.status;
      setError(
        status === 409
          ? "信息刚在其他设备更新，请点击重试。"
          : e instanceof Error
            ? e.message
            : "保存失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const keepServer = () => {
    if (busy) return;
    // 用户明确选择服务端版本：清掉本机补充事实，避免每次登录重复冲突
    supplementFactsService.clear();
    onResolved("server");
  };

  return (
    <Callout variant="ask" title="登录前填写的补充信息与账号已保存的不同">
      <div className="space-y-3" data-testid="migration-conflict-banner">
        <p className="text-sm leading-relaxed">
          本次登录前你在这台设备上补充过报考条件，而账号里已保存过一份不同的补充信息。
          请确认保留哪一份；不确认前不会覆盖任何一边。
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {guestFacts && (
            <Button size="sm" disabled={busy} onClick={() => void handleUseGuest()}>
              {busy ? "保存中…" : "使用本次填写的信息"}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={keepServer}>
            保留已保存的信息
          </Button>
        </div>
      </div>
    </Callout>
  );
}
