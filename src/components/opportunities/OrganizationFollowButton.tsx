"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { opportunitiesApi } from "@/lib/opportunities/api";
import { organizationIdentityKey } from "@/lib/opportunities/organization-follow";

/**
 * 关注单位按钮（D07 / PRD 11.8 U07）。
 *
 * 身份键 = 规范化发布主体名 + 公告级地区码，仅精确匹配；同名不同地区不串联。
 * 关注后该单位发布的新公告（经人工核对、未截止）会在站内提醒；
 * 提醒只出现在站内通知中心，不发送邮件/短信/微信。
 */
export function OrganizationFollowButton({
  publisherName,
  regionCode,
}: {
  publisherName: string;
  regionCode: string;
}) {
  const { status } = useCurrentUser();
  const identityKey = organizationIdentityKey({ publisherName, regionCode });
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    opportunitiesApi
      .listOrganizationFollows()
      .then((rows) => {
        if (!cancelled)
          setFollowed(rows.some((row) => row.identityKey === identityKey));
      })
      .catch(() => {
        // 读取失败按未关注展示，点击时由服务端幂等兜底
        if (!cancelled) setFollowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, identityKey]);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (followed) {
        await opportunitiesApi.unfollowOrganization(identityKey);
        setFollowed(false);
        setMessage("已取消关注该单位。");
      } else {
        await opportunitiesApi.followOrganization({ publisherName, regionCode });
        setFollowed(true);
        setMessage("已关注该单位，新公告会在站内提醒你。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy || followed === null}
        onClick={() => void toggle()}
        className={
          followed
            ? "inline-flex items-center rounded-full border border-brand/30 bg-brand-soft/40 px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
            : "inline-flex items-center rounded-full border border-line px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
        }
        data-testid="organization-follow-button"
      >
        {followed ? "已关注该单位 · 取消" : "关注该单位的新公告"}
      </button>
      {message && (
        <span className="text-xs text-ink-muted" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
