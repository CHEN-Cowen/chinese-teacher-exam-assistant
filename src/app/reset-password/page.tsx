"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/layout/BrandMark";
import { resetPassword } from "@/lib/auth/password-recovery";

/**
 * M05/F7：重置密码页（邮件链接落地，?token=...）。
 *
 * 令牌 30 分钟内单次有效；成功后服务端已撤销该账号全部旧会话，
 * 引导用户用新密码重新登录。令牌缺失/失效/新密码不合规均给出
 * 可理解的错误与重试路径（重新申请）。
 */
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  // 令牌缺失直接派生错误状态（链接被截断或重复访问），不走 effect
  const missingToken = !token;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (missingToken) return;
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError("新密码至少 8 位，且同时包含字母和数字");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <BrandMark size="lg" className="justify-center" />
          <h1 className="mt-5 text-2xl font-bold tracking-[-0.02em] text-ink">
            设置新密码
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {done ? "密码已更新。" : "请为你的账号设置新密码。重置成功后，其他已登录设备需重新登录。"}
          </p>
        </div>

        <div className="rounded-3xl border border-line bg-surface p-6 shadow-[0_18px_50px_rgba(42,69,112,0.08)]">
          {done ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-brand-soft/50 border border-brand/25">
                <p className="text-sm leading-5 text-ink">
                  密码已重置，请使用新密码重新登录。
                </p>
              </div>
              <Button fullWidth size="lg" onClick={() => router.push("/login")}>
                去登录
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
                  新密码
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="至少 8 位，含字母和数字"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-ink">
                  确认新密码
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  placeholder="再次输入新密码"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-danger-soft border border-danger/30">
                  <p className="text-sm text-danger">{error}</p>
                  {error.includes("无效") || error.includes("过期") ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      可以{" "}
                      <a href="/forgot-password" className="text-brand font-medium hover:underline">
                        重新申请重置链接
                      </a>
                      。
                    </p>
                  ) : null}
                </div>
              )}

              {missingToken && !error && (
                <div className="p-3 rounded-lg bg-danger-soft border border-danger/30">
                  <p className="text-sm text-danger">
                    重置链接无效：缺少重置令牌。请从邮件中的完整链接进入。
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    可以{" "}
                    <a href="/forgot-password" className="text-brand font-medium hover:underline">
                      重新申请重置链接
                    </a>
                    。
                  </p>
                </div>
              )}

              <Button type="submit" fullWidth size="lg" loading={submitting} disabled={!token}>
                {submitting ? "提交中" : "重置密码"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          <a href="/login" className="text-brand font-medium hover:underline">
            返回登录
          </a>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams 需要 Suspense 边界以支持静态预渲染
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
