/**
 * 本机存储身份作用域（R01）。
 *
 * 背景：访问同一台设备的不同人可能先后登录不同账号；访客草稿、补充事实、
 * 分阶段教育经历和偏好撤销快照如果共用一个 localStorage 键，会把上一个身份的
 * 数据带进下一个账号。
 *
 * 规则：
 * - 访客身份保持原键（与历史数据、既有测试兼容），键名不含后缀；
 * - 已登录身份写入 `原键::user:<id>`，读取时先读自己的键，
 *   读不到再只读回退到访客原键（登录前在本机填写的内容仍可用）；
 * - 账号切换时清理撤销快照等一次性状态，避免跨账号误用。
 *
 * 本模块只依赖 localStorage，不 import @/lib/auth，避免与认证实现形成循环依赖。
 */

const ACTIVE_IDENTITY_KEY = "kb_active_identity_v1";

/** 未登录身份键 */
export const GUEST_IDENTITY = "guest";

/** 切换身份时需要清理的一次性状态键（不含画像来源数据） */
const TRANSIENT_KEY_PREFIXES = ["kb_preference_undo_v1"];

const TRANSIENT_SESSION_KEYS = ["kb_profile_migration_conflict", "kb_education_import_pending"];

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 当前本机身份：guest 或 user:<userId> */
export function getActiveIdentity(): string {
  const storage = safeLocalStorage();
  if (!storage) return GUEST_IDENTITY;
  try {
    return storage.getItem(ACTIVE_IDENTITY_KEY) || GUEST_IDENTITY;
  } catch {
    return GUEST_IDENTITY;
  }
}

/** 当前是否为已登录身份 */
export function isAuthenticatedIdentity(): boolean {
  return getActiveIdentity().startsWith("user:");
}

/** 按身份拼接存储键：访客用原键，已登录用 `原键::user:<id>` */
export function identityScopedKey(base: string, identity = getActiveIdentity()): string {
  return identity === GUEST_IDENTITY ? base : `${base}::${identity}`;
}

/**
 * 设置当前身份（登录/恢复会话/退出时调用）。
 * 身份发生变化时清理上一个身份的一次性状态（撤销快照、迁移提示），
 * 画像草稿与教育经历本身按身份隔离保存，不会串号。
 */
export function setActiveIdentity(userId: string | null | undefined): void {
  const next = userId ? `user:${userId}` : GUEST_IDENTITY;
  const previous = getActiveIdentity();
  const storage = safeLocalStorage();
  if (storage) {
    try {
      storage.setItem(ACTIVE_IDENTITY_KEY, next);
    } catch {
      // 存储不可用：保持原状，读取方按访客处理
    }
  }
  if (previous === next) return;

  // 访客 → 账号：把访客在本机填写的数据搬到该账号名下，访客键随即清空，
  // 避免同设备的其他账号读到不属于自己的访客资料。
  if (previous === GUEST_IDENTITY && userId) {
    adoptGuestDataToIdentity(userId);
  }

  // 清理其他身份的一次性状态；当前身份的保留
  if (storage) {
    try {
      const removable: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        const base = TRANSIENT_KEY_PREFIXES.find(
          (prefix) => key === prefix || key.startsWith(`${prefix}::`),
        );
        if (!base) continue;
        if (key !== identityScopedKey(base, next)) removable.push(key);
      }
      removable.forEach((key) => storage.removeItem(key));
    } catch {
      // 清理失败不影响使用：读取仍然按身份隔离
    }
  }

  if (typeof window !== "undefined") {
    try {
      TRANSIENT_SESSION_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      // sessionStorage 不可用时忽略
    }
  }
}

/** 切换到已登录身份时需要从访客键“搬迁”到账号作用域的画像来源键 */
const MIGRATABLE_GUEST_KEYS = [
  "kb_guest_profile_v61",
  "kb_profile_supplement_v61",
  "kb_profile_education_v1",
] as const;

/** 读取身份作用域数据（已登录只读自己的键，避免与访客/其他账号串联） */
export function readIdentityScopedRaw(base: string): string | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(identityScopedKey(base));
  } catch {
    return null;
  }
}

/** 写入身份作用域数据 */
export function writeIdentityScopedRaw(base: string, value: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(identityScopedKey(base), value);
}

/** 删除身份作用域数据（只删当前身份自己的键） */
export function removeIdentityScoped(base: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(identityScopedKey(base));
  } catch {
    // ignore
  }
}

/**
 * 登录时把访客在本机填写的画像来源数据搬迁到该账号的作用域。
 *
 * - 只搬迁访客原键，且账号作用域已有数据时不覆盖（账号数据优先）；
 * - 搬迁后删除访客原键，避免同设备其他账号再次读取到别人的访客资料；
 * - 搬迁只是“把数据放到账号名下”，是否真正写入服务端仍由页面上的明确确认决定。
 */
export function adoptGuestDataToIdentity(userId: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  const identity = `user:${userId}`;
  try {
    for (const base of MIGRATABLE_GUEST_KEYS) {
      const guestRaw = storage.getItem(base);
      if (guestRaw === null) continue;
      const scopedKey = identityScopedKey(base, identity);
      if (storage.getItem(scopedKey) === null) {
        storage.setItem(scopedKey, guestRaw);
      }
      storage.removeItem(base);
    }
  } catch {
    // 存储不可用：保持现状，读取方仍按身份隔离
  }
}
