"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/layout/BrandMark";
import { requestPasswordReset } from "@/lib/auth/password-recovery";

/**
 * M05/F7：忘记密码页。
 *
 * 服务端防枚举：无论邮箱是否注册，响应一致；本页只展示统一文案，
 * 不提示「该邮箱不存在」等信息。提交后进入「请查收邮件」状态。
 * 邮件服务未配置时用户将收不到邮件（服务端日志留痕）；文案保持一致，
 * 由部署方在开通邮件服务后此流程才完整可用（受控状态，不伪装成功）。
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("请输入注册邮箱");
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestPasswordReset(email);
      setNotice(result.message);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
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
            找回密码
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            输入注册邮箱，我们会发送一封包含重置链接的邮件（30 分钟内有效）。
          </p>
        </div>

        <div className="rounded-3xl border border-line bg-surface p-6 shadow-[0_18px_50px_rgba(42,69,112,0.08)]">
          {submitted ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-brand-soft/50 border border-brand/25">
                <p className="text-sm leading-5 text-ink">{notice}</p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  没有收到？请检查垃圾邮件，或稍后重新提交。重置链接 30 分钟内有效。
                </p>
              </div>
              <Button fullWidth size="lg" onClick={() => router.push("/login")}>
                返回登录
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
                  注册邮箱
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-danger-soft border border-danger/30">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}

              <Button type="submit" fullWidth size="lg" loading={submitting}>
                {submitting ? "提交中" : "发送重置链接"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          想起密码了？{" "}
          <a href="/login" className="text-brand font-medium hover:underline">
            返回登录
          </a>
        </p>
      </div>
    </div>
  );
}
