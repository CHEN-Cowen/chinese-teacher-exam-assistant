/**
 * M05/F7：注册与找回的输入校验（纯函数，便于单测）。
 *
 * 邮箱：RFC 简化校验 + 长度上限（≤254，防极端输入）；
 * 密码：8–72 位且同时含字母与数字（bcrypt 输入上限 72 字节，
 * 超出部分会被静默截断，必须显式拒绝而非依赖库行为）。
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /[A-Za-z]/;
const DIGIT_PATTERN = /\d/;
/** bcrypt 只处理前 72 字节，超出静默截断 → 显式拒绝 */
export const PASSWORD_MAX_BYTES = 72;

export function validateEmail(raw: unknown): { ok: true; email: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: '邮箱必须为字符串' };
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, reason: '邮箱不能为空' };
  if (email.length > 254) return { ok: false, reason: '邮箱过长（最多 254 个字符）' };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, reason: '邮箱格式不正确' };
  return { ok: true, email };
}

export function validatePassword(raw: unknown): { ok: true; password: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: '密码必须为字符串' };
  if (raw.length < 8) return { ok: false, reason: '密码至少 8 位' };
  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX_BYTES) {
    return { ok: false, reason: `密码过长（最多 ${PASSWORD_MAX_BYTES} 字节）` };
  }
  if (!PASSWORD_PATTERN.test(raw) || !DIGIT_PATTERN.test(raw)) {
    return { ok: false, reason: '密码须同时包含字母和数字' };
  }
  return { ok: true, password: raw };
}

/** 兼容既有 6 位规则的历史账号校验场景：仅校验非空与字节上限 */
export function isPlausiblePassword(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.length > 0 &&
    Buffer.byteLength(raw, 'utf8') <= PASSWORD_MAX_BYTES
  );
}
