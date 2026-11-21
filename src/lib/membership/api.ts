/**
 * 会员权益 API 客户端（M11）。
 *
 * - GET /api/membership/plans：公开套餐与售卖开关（价格页，未登录可读）；
 * - GET /api/membership/mine：当前用户会员状态（仅 invited 模式调用）。
 *
 * demo / 无后端环境的回退策略（诚实原则）：
 * - 套餐用静态镜像展示（tests/membership-parity.test.ts 与后端配置锁定一致）；
 * - 会员状态一律回退为「免费」，绝不虚构已开通或已到期。
 */
import { AUTH_MODE } from "@/lib/auth";
import {
  MEMBERSHIP_PLANS_STATIC,
  type MembershipPlanKey,
} from "./plans";

const API_BASE = "/api/membership";

export interface MembershipPlanDTO {
  key: MembershipPlanKey;
  label: string;
  days: number;
  priceCents: number;
  per30dReferenceCents: number;
  featured: boolean;
  purchasable: boolean;
}

export interface MembershipPlansDTO {
  salesOpen: boolean;
  plans: MembershipPlanDTO[];
  activeEntitlements: string[];
}

export interface MembershipViewDTO extends MembershipPlansDTO {
  membership: {
    status: "free" | "active" | "expired";
    plan: MembershipPlanKey | null;
    startsAt: string | null;
    endsAt: string | null;
  };
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** 静态回退：售卖未开通（当前默认态），全部套餐不可购 */
export function staticPlansFallback(): MembershipPlansDTO {
  return {
    salesOpen: false,
    plans: MEMBERSHIP_PLANS_STATIC.map((plan) => ({
      ...plan,
      purchasable: false,
    })),
    activeEntitlements: [],
  };
}

/** 静态回退：免费态（demo / 未登录语义下不虚构会员状态） */
export function staticFreeMembership(): MembershipViewDTO {
  return {
    ...staticPlansFallback(),
    membership: {
      status: "free",
      plan: null,
      startsAt: null,
      endsAt: null,
    },
  };
}

/** 公开套餐与售卖开关（价格页）。后端不可达时回退静态镜像。 */
export async function fetchMembershipPlans(): Promise<MembershipPlansDTO> {
  if (AUTH_MODE === "demo") return staticPlansFallback();
  try {
    return await request<MembershipPlansDTO>("/plans");
  } catch {
    return staticPlansFallback();
  }
}

/**
 * 当前用户会员状态（我的页）。
 * demo 模式返回静态免费态；invited 模式请求失败时抛错，由调用方决定隐藏卡片。
 */
export async function fetchMyMembership(): Promise<MembershipViewDTO> {
  if (AUTH_MODE === "demo") return staticFreeMembership();
  return request<MembershipViewDTO>("/mine");
}
