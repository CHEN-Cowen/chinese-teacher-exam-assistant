import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module.js';
import { MembershipModule } from '../membership/membership.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsAdminController } from './payments-admin.controller.js';
import { PaymentsCallbacksController } from './payments-callbacks.controller.js';
import { PaymentsService } from './payments.service.js';
import { getPaymentConfig } from './payment.config.js';
import { PAYMENT_CHANNEL, type PaymentChannel } from './channels/payment-channel.js';
import { MockWechatChannel } from './channels/mock-wechat.channel.js';

/**
 * 支付模块（M12）。
 *
 * 渠道由 PAYMENT_CHANNEL 配置决定：
 * - wechat_mock（默认/当前唯一实现）：HMAC 模拟渠道，演练完整验签与履约链路；
 * - wechat_native / wechat_jsapi / wechat_h5：预留真实渠道标识，按实际获批
 *   商户权限接入；实现未落地前配置它会直接抛错（宁可启动失败，也不静默
 *   回退到模拟渠道冒充真实支付）。
 */
@Module({
  imports: [PrismaModule, MembershipModule],
  controllers: [
    PaymentsController,
    PaymentsAdminController,
    PaymentsCallbacksController,
  ],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_CHANNEL,
      useFactory: (): PaymentChannel => {
        const config = getPaymentConfig();
        if (config.channelName === 'wechat_mock') {
          return new MockWechatChannel(config.mchId, config.mockSecret);
        }
        throw new Error(
          `支付渠道 ${config.channelName} 尚未接入：真实微信支付需要商户号、` +
            `APIv3 密钥、平台证书与已备案回调域名（见 payment.config.ts 配置清单）。` +
            `未配齐前请使用 wechat_mock 并保持"模拟通道"标识。`,
        );
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
