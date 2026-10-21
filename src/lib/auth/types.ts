import { User, UserRole } from "@/types";

/**
 * 当前登录会话。
 * 真实后端接入后，该结构可映射为后端返回的 access token + 用户信息。
 */
export interface Session {
  /** 会话令牌：Demo 阶段为本地生成的模拟 token，不具备真实安全性 */
  token: string;
  userId: string;
  role: UserRole;
  user: User;
  /** 登录时间（ISO 字符串） */
  loginAt: string;
  /** 会话过期时间（ISO 字符串） */
  expiresAt: string;
}

export interface AuthCredentials {
  /** 登录账号：Demo 阶段为演示邮箱 */
  account: string;
  password: string;
}

/** 公开注册入参（仅受邀环境 + PUBLIC_REGISTRATION 开启时可用） */
export interface RegistrationInput {
  email: string;
  password: string;
  name?: string;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type SessionInvalidReason = "expired" | "unauthorized";

/**
 * 认证服务接口。
 *
 * 页面和组件只依赖该接口（通过 useCurrentUser / AuthContext 使用），
 * 当前由 DemoAuthProvider 实现；接入真实后端时新增 HttpAuthProvider
 *（调用 /api/auth/login、/api/auth/session 等）并在 AuthProvider 中替换即可，
 * 页面代码无需修改。
 */
export interface AuthService {
  /** 登录，成功返回会话；账号密码错误时抛出异常 */
  login(credentials: AuthCredentials): Promise<Session>;
  /**
   * 公开注册：受邀环境且 PUBLIC_REGISTRATION 开启时可用，注册即登录。
   * 不支持的实现（如 Demo）应抛出异常。
   */
  register(input: RegistrationInput): Promise<Session>;
  /** 退出登录，清除本地会话 */
  logout(): Promise<void>;
  /**
   * 恢复会话：Demo 模式同步读 localStorage；invited 模式异步请求 /api/auth/session。
   * 不存在、解析失败或已过期时返回 null（过期会同时清除本地记录）。
   */
  restoreSession(): Session | null | Promise<Session | null>;
  /** 读取当前原始会话（不做过期跳转判断），供 service 层取用户信息 */
  getSession(): Session | null;
  /** 更新会话中的用户资料，返回更新后的会话 */
  updateProfile(patch: Partial<User>): Session;
  /** 订阅会话变化（如 service 层直接更新会话时同步 UI） */
  subscribe(listener: () => void): () => void;
}
