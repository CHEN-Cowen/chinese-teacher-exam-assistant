/**
 * M05/F7：密码找回 API（忘记密码 / 重置密码）。
 *
 * 与 HttpAuthProvider 同约定：走同源 /api 反代，cookie 语义由浏览器管理；
 * 响应体不区分「邮箱是否注册」（服务端防枚举），前端照实展示统一文案。
 */

const API_BASE = "/api/auth";

export interface ForgotPasswordResult {
  ok: boolean;
  message: string;
}

export async function requestPasswordReset(email: string): Promise<ForgotPasswordResult> {
  const res = await fetch(`${API_BASE}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ForgotPasswordResult>;
  if (!res.ok) {
    throw new Error(body.message || "提交失败，请稍后重试");
  }
  return { ok: true, message: body.message || "若该邮箱已注册，将收到一封包含重置链接的邮件" };
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || "重置失败，请稍后重试");
  }
}
