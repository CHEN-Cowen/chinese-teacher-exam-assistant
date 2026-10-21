"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { User, UserRole } from "@/types";
import { AuthCredentials, AuthStatus, RegistrationInput, Session } from "./types";
import { authService } from "./instance";

interface AuthContextValue {
  /** 会话恢复状态：首次挂载时为 loading，恢复完成后为 authenticated/unauthenticated */
  status: AuthStatus;
  session: Session | null;
  /** 当前登录用户，未登录时为 null */
  user: User | null;
  role: UserRole | null;
  login: (credentials: AuthCredentials) => Promise<Session>;
  /** 公开注册（仅受邀环境 + PUBLIC_REGISTRATION 开启时可用），注册即登录 */
  register: (input: RegistrationInput) => Promise<Session>;
  logout: () => Promise<void>;
  /** 修改当前用户基础资料（学段、可用时间、通知偏好等） */
  updateProfile: (patch: Partial<User>) => User;
  hasRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // 初始统一为 loading，在客户端 effect 中恢复会话，避免 SSR/hydration 状态不一致
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const applySession = (next: Session | null) => {
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    };

    // 挂载时恢复会话：Demo 同步、invited 异步请求服务端
    Promise.resolve(authService.restoreSession()).then(applySession);

    // service 层变更会话时（登录/退出/资料更新）同步到 React 状态
    return authService.subscribe(() => {
      applySession(authService.getSession());
    });
    // authService 为模块级单例（见 ./instance），引用恒定，无需作为依赖
  }, []);

  const login = useCallback(
    async (credentials: AuthCredentials) => {
      const next = await authService.login(credentials);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    []
  );

  const register = useCallback(
    async (input: RegistrationInput) => {
      const next = await authService.register(input);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    []
  );

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const updateProfile = useCallback(
    (patch: Partial<User>) => {
      const updated = authService.updateProfile(patch);
      setSession(updated);
      setStatus("authenticated");
      return updated.user;
    },
    []
  );

  const hasRole = useCallback(
    (roles: UserRole[]) => {
      return session ? roles.includes(session.role) : false;
    },
    [session]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      role: session?.role ?? null,
      login,
      register,
      logout,
      updateProfile,
      hasRole,
    }),
    [status, session, login, register, logout, updateProfile, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useCurrentUser 必须在 <AuthProvider> 内部使用");
  }
  return ctx;
}

/** 语义化别名：守卫等场景使用 */
export const useAuth = useCurrentUser;
