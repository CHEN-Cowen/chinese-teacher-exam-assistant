import { User } from "@/types";
import { STORAGE_KEYS } from "@/lib/mock-data";
import { loadFromStorage, saveToStorage, removeFromStorage } from "@/lib/storage";
import { setActiveIdentity } from "@/lib/storageIdentity";
import { AuthCredentials, AuthService, Session } from "./types";
import { DEMO_ACCOUNTS } from "./demo-accounts";

/** 演示会话有效期：7 天 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 模拟网络延迟 */
const NETWORK_DELAY_MS = 400;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Demo 认证实现：
 * - 账号校验在本地完成（明文比对演示账号）；
 * - 会话保存在 localStorage，可在刷新后恢复；
 * - 不提供任何真实安全保障，仅限产品原型与前端联调使用。
 *
 * 接入真实后端时，新建 HttpAuthProvider 实现同一个 AuthService 接口即可替换。
 */
export class DemoAuthProvider implements AuthService {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }

  async login(credentials: AuthCredentials): Promise<Session> {
    await delay(NETWORK_DELAY_MS);

    const account = credentials.account.trim().toLowerCase();
    const matched = DEMO_ACCOUNTS.find(
      (item) => item.account.toLowerCase() === account && item.password === credentials.password
    );

    if (!matched) {
      throw new Error("账号或密码不正确，请使用下方演示账号登录");
    }

    const now = Date.now();
    const session: Session = {
      token: `demo-token-${btoa(matched.user.id)}-${now}`,
      userId: matched.user.id,
      role: matched.user.role,
      user: {
        ...matched.user,
        updatedAt: new Date(now).toISOString(),
      },
      loginAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };

    // R01：切换本机存储作用域到该账号，避免上一个身份的草稿/快照被误用
    setActiveIdentity(session.userId);
    this.persist(session);
    return session;
  }

  async logout(): Promise<void> {
    await delay(NETWORK_DELAY_MS / 2);
    removeFromStorage(STORAGE_KEYS.SESSION);
    setActiveIdentity(null);
    this.emitChange();
  }

  async register(): Promise<Session> {
    throw new Error("演示环境不支持注册，请使用内置演示账号登录");
  }

  getSession(): Session | null {
    if (typeof window === "undefined") return null;
    return loadFromStorage<Session | null>(STORAGE_KEYS.SESSION, null);
  }

  restoreSession(): Session | null {
    const session = this.getSession();
    if (!session) {
      setActiveIdentity(null);
      return null;
    }

    // 会话结构不完整视为无效
    if (!session.token || !session.user || !session.expiresAt) {
      removeFromStorage(STORAGE_KEYS.SESSION);
      setActiveIdentity(null);
      this.emitChange();
      return null;
    }

    // 会话已过期：打标记供登录页提示“会话已失效”
    if (Date.now() >= new Date(session.expiresAt).getTime()) {
      removeFromStorage(STORAGE_KEYS.SESSION);
      setActiveIdentity(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("kb_session_expired", "1");
      }
      this.emitChange();
      return null;
    }

    // R01：刷新后恢复本机存储作用域，与当前会话账号一致
    setActiveIdentity(session.userId);
    return session;
  }

  updateProfile(patch: Partial<User>): Session {
    const current = this.getSession();
    if (!current) {
      throw new Error("当前没有可更新的会话");
    }

    const updated: Session = {
      ...current,
      user: {
        ...current.user,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    // 角色与用户ID以会话顶层为准，资料更新不允许提权
    updated.role = updated.user.role;

    this.persist(updated);
    return updated;
  }

  private persist(session: Session): void {
    saveToStorage(STORAGE_KEYS.SESSION, session);
    this.emitChange();
  }
}
