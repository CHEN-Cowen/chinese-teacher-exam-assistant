import { User } from "@/types";
import { AuthCredentials, AuthService, RegistrationInput, Session } from "./types";
import { profileApi } from "@/lib/profile/profileApi";

const API_BASE = "/api/auth";

/**
 * 受邀模式认证实现（模块 8）。
 *
 * - 登录走 POST /api/auth/login，身份由 HttpOnly Cookie 承载，前端不保存任何令牌；
 * - 会话用户信息只存在内存中（刷新时通过 GET /api/auth/session 恢复）；
 * - 绝不把 token 写入 localStorage，cookie 由浏览器自动管理，JS 无法读取。
 */
export class HttpAuthProvider implements AuthService {
  private listeners = new Set<() => void>();
  private session: Session | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }

  private buildSession(user: User): Session {
    const now = new Date().toISOString();
    return {
      token: "cookie-session",
      userId: user.id,
      role: user.role,
      user,
      loginAt: now,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async login(credentials: AuthCredentials): Promise<Session> {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: credentials.account,
        password: credentials.password,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || "登录失败，请检查邮箱和密码");
    }
    const data = (await res.json()) as { user: User };
    this.session = this.buildSession(data.user);
    // v7.2 登录迁移：服务端非空优先；缺失则迁入；冲突要求用户确认，不静默覆盖。
    // 必须在通知"已登录"前完成：机会页首屏 match 依赖服务端已持久化的画像，
    // 否则与迁移请求竞态导致首次匹配为空；迁移失败不阻塞登录本身。
    try {
      const outcome = await profileApi.migrateGuestProfileIfNeeded();
      if (outcome.kind === "conflict") {
        // 两边冲突时存入 sessionStorage（含访客补充事实），由机会页 Banner 引导用户确认；
        // 不清除访客草稿（不静默丢弃），不覆盖服务端（不静默覆盖）。
        sessionStorage.setItem(
          "kb_profile_migration_conflict",
          JSON.stringify({
            at: new Date().toISOString(),
            ...(outcome.guestFacts ? { guestFacts: outcome.guestFacts } : {}),
          }),
        );
      }
    } catch {
      // 迁移失败不阻塞登录；用户可在机会页重新完善画像
    }
    this.emitChange();
    return this.session;
  }

  async register(input: RegistrationInput): Promise<Session> {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        name: input.name,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || "注册失败，请稍后重试");
    }
    const data = (await res.json()) as { user: User };
    this.session = this.buildSession(data.user);
    this.emitChange();
    return this.session;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // 网络异常不阻塞本地登出
    }
    this.session = null;
    this.emitChange();
  }

  getSession(): Session | null {
    return this.session;
  }

  async restoreSession(): Promise<Session | null> {
    try {
      const res = await fetch(`${API_BASE}/session`, {
        credentials: "include",
      });
      if (!res.ok) {
        this.session = null;
        this.emitChange();
        return null;
      }
      const data = (await res.json()) as { user: User };
      this.session = this.buildSession(data.user);
      return this.session;
    } catch {
      return null;
    }
  }

  updateProfile(patch: Partial<User>): Session {
    if (!this.session) {
      throw new Error("当前没有可更新的会话");
    }
    const updated: Session = {
      ...this.session,
      user: {
        ...this.session.user,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    updated.role = updated.user.role;
    this.session = updated;
    this.emitChange();
    return updated;
  }
}
