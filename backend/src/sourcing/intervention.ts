/**
 * v7.2 工作包 4：人工介入信号识别（验证码 / 登录 / 封禁）。
 *
 * 技术方案 §4.3：验证码、登录和封禁视为人工处理，不做绕过；
 * 探测到即把来源标记为 blocked 并暂停自动化，交由管理员手动提交。
 *
 * 只做确定性识别，不猜测、不绕过：
 * - HTTP 401 → 需要登录；
 * - HTTP 403 → 被拒绝/封禁；
 * - 成功返回的 HTML 出现强验证码标记 → 站点挑战页（人机验证）。
 */
import { SafeFetchError } from './fetch/safe-fetcher.js';

export type InterventionReason =
  | 'login_required'
  | 'forbidden'
  | 'captcha_challenge';

/** 强挑战标记：政府公告正文极少出现，误判成本是“转人工”，比静默抓取更安全 */
const CAPTCHA_MARKERS =
  /(验证码|captcha|人机验证|滑动验证|安全验证|访问验证|行为验证)/i;

/** 从抓取错误识别人工介入信号；普通失败返回 null */
export function interventionFromError(error: unknown): InterventionReason | null {
  if (error instanceof SafeFetchError && error.code === 'HTTP_ERROR') {
    if (error.status === 401) return 'login_required';
    if (error.status === 403) return 'forbidden';
  }
  return null;
}

/** 从成功返回的页面体识别验证码挑战页；非 HTML 或未命中返回 null */
export function interventionFromBody(
  body: string,
  mimeType: string,
): InterventionReason | null {
  if (!mimeType.toLowerCase().includes('html')) return null;
  return CAPTCHA_MARKERS.test(body) ? 'captcha_challenge' : null;
}
