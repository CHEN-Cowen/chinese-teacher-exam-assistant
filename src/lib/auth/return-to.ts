/**
 * 登录回程（return-to）纯函数（v7.2 FR-1）。
 *
 * 保存/咨询触发登录时携带 `?next=/opportunities/<unitId>`，登录成功后必须：
 * 1. 只接受站内相对路径，拒绝外域与协议相对 URL（防开放重定向）；
 * 2. 绝不落到 /onboarding——保存不等于进入基础画像流程；
 * 3. 非法/缺省 next 统一回机会列表，保证有明确落地页。
 */

/** 校验并净化 next 参数；不合法返回 null（调用方应回退到默认页） */
export function safeReturnPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  // 必须以单个 "/" 开头：挡住 https://、javascript: 等绝对 URL
  if (!value.startsWith("/")) return null;
  // 协议相对 URL（//evil.com）在浏览器里可指向外域
  if (value.startsWith("//")) return null;
  // 保存与咨询回程绝不进基础画像问答（精确到路径段，挡住 /onboarding/xxx 绕过）
  if (
    value === "/onboarding" ||
    value.startsWith("/onboarding/") ||
    value.startsWith("/onboarding?") ||
    value.startsWith("/onboarding#")
  ) {
    return null;
  }
  return value;
}

/** 登录成功后的最终落地路径；/preview 是旧试用入口，统一归并到机会列表 */
export function resolvePostLoginPath(
  value: string | null | undefined,
): string {
  const safe = safeReturnPath(value);
  if (!safe || safe === "/preview") return "/opportunities";
  return safe;
}
