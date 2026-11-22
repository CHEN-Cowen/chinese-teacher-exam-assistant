import type { ReactNode } from "react";

/**
 * 统一页头（2026-11 视觉统一）：一行标题 + 可选右侧操作，无功能说明副标题。
 * 判定标准：一句话能让用户自解释的功能，不需要在标题下再解释一遍；
 * 覆盖范围、更新时间等数据事实由各页 Hero/Callout 承载，不进页头。
 * 标题规格全站唯一：text-2xl font-semibold tracking-tight。
 */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </header>
  );
}
