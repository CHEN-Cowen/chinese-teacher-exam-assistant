/**
 * 支付配置（M12）。
 *
 * 配置清单（密钥仅存服务端，绝不进入前端包或仓库）：
 * - PAYMENT_CHANNEL：支付渠道标识。当前实现 'wechat_mock'（默认，模拟渠道）。
 *   真实渠道标识预留 wechat_native / wechat_jsapi / wechat_h5——按实际获批的
 *   商户权限三选一，不得假定权限齐全；真实渠道实现未落地前配置它会直接报错，
 *   不允许静默回退到模拟渠道冒充真实支付。
 * - PAYMENT_MOCK_ENABLED='true'：开放模拟支付端点与模拟渠道（开发/验收用）。
 *   默认关闭；生产环境不应开启。
 * - PAYMENT_MOCK_SECRET：模拟渠道 HMAC 密钥（仅演练验签流程，默认值为开发专用，
 *   任何共享部署环境都必须覆盖）。
 * - PAYMENT_MCH_ID：本系统在渠道侧的商户号（回调核对用），模拟渠道默认 mock-mch-001。
 *
 * 真实微信支付所需但当前未配置（受阻项，获批后按官方文档接入）：
 * WECHAT_MCH_ID / WECHAT_APP_ID / WECHAT_API_V3_KEY / WECHAT_PRIVATE_KEY /
 * WECHAT_SERIAL_NO / 已备案回调域名与平台证书。
 */

export interface PaymentConfig {
  channelName: string;
  mchId: string;
  mockEnabled: boolean;
  mockSecret: string;
}

export function getPaymentConfig(): PaymentConfig {
  return {
    channelName: process.env.PAYMENT_CHANNEL ?? 'wechat_mock',
    mchId: process.env.PAYMENT_MCH_ID ?? 'mock-mch-001',
    mockEnabled: process.env.PAYMENT_MOCK_ENABLED === 'true',
    mockSecret: process.env.PAYMENT_MOCK_SECRET ?? 'mock-dev-secret-not-for-production',
  };
}
