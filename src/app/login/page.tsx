"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/layout/BrandMark";
import { AUTH_MODE, useCurrentUser, DEMO_ACCOUNTS } from "@/lib/auth";
import { resolvePostLoginPath, safeReturnPath } from "@/lib/auth/return-to";
import { isDemoMode } from "@/lib/demo/config";
import { opportunitiesApi } from "@/lib/opportunities/api";
import {
  listGuestFollows,
  clearGuestFollows,
} from "@/lib/guest/guestFollows";
import { guestSessionService } from "@/lib/guest/guestSession";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register, status } = useCurrentUser();
  const demo = isDemoMode;
  // 公开注册开关：仅受邀环境 + NEXT_PUBLIC_PUBLIC_REGISTRATION=true 时开放（构建期内联）
  const registrationEnabled =
    !demo && process.env.NEXT_PUBLIC_PUBLIC_REGISTRATION === "true";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const nextParam = searchParams.get("next");
  const reason = searchParams.get("reason");

  // 会话过期标记（由 DemoAuthProvider 写入 sessionStorage）
  const [sessionExpired] = useState(() => {
    if (typeof window === "undefined") return false;
    const expired = window.sessionStorage.getItem("kb_session_expired") === "1";
    if (expired) window.sessionStorage.removeItem("kb_session_expired");
    return expired;
  });

  // v7.2：回程路径只接受站内相对路径，且绝不落到 /onboarding
  const nextPath = safeReturnPath(nextParam);
  const returningToOpportunity = nextPath?.startsWith("/opportunities/") === true;
  const continuingTrial = nextPath === "/opportunities";
  const [hasGuestProfile] = useState(() => {
    if (typeof window === "undefined") return false;
    return guestSessionService.isComplete();
  });

  // 已登录用户访问登录页时直接跳转；登录成功后先合并访客本机关注，再跳转。
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      const guestItems = listGuestFollows();
      let merged = guestItems.length === 0;
      if (guestItems.length > 0) {
        try {
          await opportunitiesApi.mergeGuestFollows(
            guestItems.map((g) => ({
              unitId: g.unitId,
              status: g.status,
              materialStatuses: g.materialStatuses,
              consultationNotes: g.consultationNotes,
            })),
          );
          merged = true;
        } catch {
          // 合并失败不阻塞登录：保留本地记录，下次登录再试
        }
      }
      if (cancelled) return;
      if (merged) clearGuestFollows();
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          "kb_post_login_notice",
          guestItems.length > 0 && merged
            ? "登录成功，刚才保存的机会已同步到账号。接下来可以查看报名时间。"
            : returningToOpportunity
              ? "登录成功，已回到刚才查看的机会。"
              : continuingTrial
                ? "登录成功，已按刚才填写的报考信息进入机会列表。"
              : "登录成功，已回到你的机会列表。",
        );
      }
      router.replace(resolvePostLoginPath(nextPath));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const fillDemoAccount = (demoAccount: string, demoPassword: string) => {
    setAccount(demoAccount);
    setPassword(demoPassword);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (!account.trim() || !password) {
        setError("请输入邮箱和密码");
        return;
      }
      setSubmitting(true);
      try {
        await register({
          email: account.trim(),
          password,
          name: name.trim() || undefined,
        });
        // 注册成功后的访客迁移与跳转统一在 useEffect（status 变化）中处理
      } catch (err) {
        setError(err instanceof Error ? err.message : "注册失败，请稍后重试");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!account.trim() || !password) {
      setError("请输入账号和密码");
      return;
    }

    setSubmitting(true);
    try {
      await login({ account: account.trim(), password });
      // 登录成功后的访客迁移与跳转统一在上面的 useEffect（status 变化）中处理，
      // 避免两次调用迁移、两次 router.replace 互相覆盖。
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-sm">
        {/* 品牌区 */}
        <div className="mb-7 text-center">
          <BrandMark size="lg" className="justify-center" />
          <h1 className="mt-5 text-2xl font-bold tracking-[-0.02em] text-ink">
            {mode === "register" ? "注册体验账号" : "欢迎回来"}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {mode === "register"
              ? "现场体验：填写邮箱和密码即可创建账号并登录"
              : returningToOpportunity
                ? "登录后会回到刚才的机会，继续完成保存"
                : continuingTrial
                  ? "登录后继续查看机会、材料清单和报考日程"
                  : "登录后继续查看已保存机会与报考进度"}
          </p>
        </div>

        <div className="rounded-3xl border border-line bg-surface p-6 shadow-[0_18px_50px_rgba(42,69,112,0.08)]">
          {/* Demo 声明 */}
          {demo && (
            <div className="mb-4 p-3 rounded-lg bg-warn-soft border border-warn/30">
              <p className="text-xs leading-5 text-warn">
                <strong>演示环境提示：</strong>
                这里使用的是内置演示账号，<strong>不是真实身份认证</strong>，没有真实注册与密码校验；
                演示数据仅保存在本机浏览器，不代表正式服务数据。请勿输入真实密码或其他个人信息。
              </p>
            </div>
          )}

          {/* 会话失效提示 */}
          {(sessionExpired || reason === "expired") && (
            <div className="mb-4 p-3 rounded-lg bg-canvas border border-line">
              <p className="text-xs leading-5 text-ink-muted">
                登录状态已过期，请重新登录。
              </p>
            </div>
          )}

          {/* v7.1 M8：触发登录的提示文案——保存/订阅/设主要目标/跨设备同步 */}
          {AUTH_MODE === "invited" && (reason === "save" || reason === "subscribe" || reason === "set_primary" || (continuingTrial && hasGuestProfile)) && (
            <div className="mb-4 rounded-lg border border-brand/25 bg-brand-soft/50 p-3">
              <p className="text-xs leading-5 text-ink-muted">
                登录后会同步你刚才填写的信息，无需重新填写。
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-sm font-medium text-ink"
                >
                  昵称（选填）
                </label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder="例如：考生小张"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="account"
                className="mb-1.5 block text-sm font-medium text-ink"
              >
                邮箱
              </label>
              <input
                id="account"
                type="text"
                autoComplete="username"
                placeholder={demo ? "演示邮箱，例如 student@demo.app" : "邮箱"}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-ink"
              >
                密码
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={demo ? "演示密码：demo1234" : mode === "register" ? "至少 8 位，含字母和数字" : "密码"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-brand/30 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger/30">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <Button type="submit" fullWidth size="lg" loading={submitting}>
              {submitting
                ? mode === "register"
                  ? "注册中"
                  : "登录中"
                : mode === "register"
                  ? "注册并登录"
                  : "登录"}
            </Button>
          </form>

          {/* M05/F7：忘记密码入口（仅真实认证模式；demo 无真实密码可找回） */}
          {!demo && mode === "login" && (
            <p className="mt-3 text-center text-sm">
              <a href="/forgot-password" className="text-ink-muted hover:text-brand hover:underline">
                忘记密码？
              </a>
            </p>
          )}

          {/* 公开注册切换入口（仅受邀环境 + 开关开启时显示） */}
          {registrationEnabled && (
            <div className="mt-5 border-t border-line pt-4 text-center">
              {mode === "login" ? (
                <p className="text-sm text-ink-muted">
                  还没有账号？{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("register");
                      setError("");
                    }}
                    className="text-brand font-medium hover:underline"
                  >
                    现场注册体验账号
                  </button>
                </p>
              ) : (
                <p className="text-sm text-ink-muted">
                  已有账号？{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError("");
                    }}
                    className="text-brand font-medium hover:underline"
                  >
                    返回登录
                  </button>
                </p>
              )}
            </div>
          )}

          {/* 演示账号快捷填充 */}
          {demo && (
            <div className="mt-6">
              <p className="text-xs font-medium text-ink-muted mb-2">
                演示账号（点击自动填充，密码均为 demo1234）
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((item) => (
                  <button
                    key={item.account}
                    type="button"
                    onClick={() => fillDemoAccount(item.account, item.password)}
                    className="text-left p-2.5 rounded-lg border border-line hover:border-blue-400 hover:bg-brand-soft/50 transition-colors"
                  >
                    <p className="text-sm font-medium text-ink">{item.description}</p>
                    <p className="text-xs text-ink-muted truncate mt-0.5">{item.account}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-ink-muted">
          {demo
            ? "未注册账号？Demo 阶段无需注册，请直接使用演示账号"
            : registrationEnabled
              ? "现场体验环境，可用邮箱自助注册"
              : "仅限受邀测试用户，不开放公开注册"}
        </p>
        {nextPath === "/preview" && (
          <p className="text-center text-xs mt-3">
            <a href="/preview" className="text-brand hover:underline">
              暂不登录，返回查看我的结果
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams 需要 Suspense 边界以支持静态预渲染
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
