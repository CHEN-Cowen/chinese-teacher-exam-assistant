/**
 * 支付 API 客户端（M12）。
 *
 * - 全部接口需登录（invited 模式会话 cookie）；
 * - demo 模式无真实后端：购买流程不激活（价格页静态回退中 purchasable=false），
 *   客户端函数被调用时直接抛错，绝不虚构订单或支付成功；
 * - mockChannel=true 时前端必须明确标识「模拟支付通道」，不得展示为真实微信支付。
 */

export interface PaymentOrderDTO {
  id: string;
  plan: string;
  planLabel: string;
  days: number;
  amountCents: number;
  currency: string;
  priceVersion: string;
  status: "created" | "paying" | "paid" | "closed" | "refunded";
  channel: string;
  mockChannel: boolean;
  simulateAllowed: boolean;
  prepay: { attemptId: string; codeUrl?: string } | null;
  paidAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

const API_BASE = "/api/payments";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = body.message || body.error || `请求失败 (${res.status})`;
    const error = new Error(Array.isArray(message) ? message[0] : message);
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

/** 创建订单（服务端定价；金额以返回的订单为准） */
export function createPaymentOrder(plan: string): Promise<PaymentOrderDTO> {
  return request<PaymentOrderDTO>("/orders", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

/** 发起支付：返回渠道预支付参数（模拟渠道为 codeUrl） */
export function startPayment(orderId: string): Promise<PaymentOrderDTO> {
  return request<PaymentOrderDTO>(`/orders/${orderId}/pay`, { method: "POST" });
}

/** 查询订单；sync=true 时服务端向渠道主动查单补账 */
export function fetchPaymentOrder(orderId: string, sync = false): Promise<PaymentOrderDTO> {
  return request<PaymentOrderDTO>(`/orders/${orderId}${sync ? "?sync=1" : ""}`);
}

/** 关闭未支付订单 */
export function closePaymentOrder(orderId: string): Promise<PaymentOrderDTO> {
  return request<PaymentOrderDTO>(`/orders/${orderId}/close`, { method: "POST" });
}

/**
 * 模拟支付成功（仅模拟渠道且服务端开启 PAYMENT_MOCK_ENABLED）。
 * 仍走完整验签回调链路；「渠道扣款」由模拟账本产生，不代表真实资金。
 */
export function simulateMockSuccess(orderId: string): Promise<{ code: string }> {
  return request<{ code: string }>("/mock/simulate-success", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });
}
