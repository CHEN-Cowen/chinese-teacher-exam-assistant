/**
 * M05/F7：邮件投递出口。
 *
 * 受控状态设计——未配置 SMTP 时绝不伪装发送成功：
 * - EMAIL_ENABLED !== 'true'：configured=false，send() 返回 { delivered: false }，
 *   令牌不会被投递到任何地址；调用方（忘记密码）记录日志并照常返回
 *   统一响应（防账号枚举），前端与用户看到的是「若邮箱已注册将收到邮件」。
 * - EMAIL_ENABLED=true：经 nodemailer 用 SMTP 配置真实投递；收件人、
 *   主题与正文由调用方给出，本服务不做业务判断。
 *
 * 配置步骤（deploy/backend.env.example 同步维护）：
 *   EMAIL_ENABLED=true
 *   SMTP_HOST=smtp.example.com
 *   SMTP_PORT=465
 *   SMTP_USER=...（可选）
 *   SMTP_PASS=...（可选，仅服务端保存）
 *   SMTP_FROM="教招有据 <no-reply@example.com>"
 *
 * 真实投递验证待邮件服务开通后执行（执行记录中标注「未在线上验证」）。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  /** delivered=false 时的原因（仅日志使用，不返回给终端用户） */
  reason?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private cachedTransport: {
    send: (input: MailInput) => Promise<unknown>;
  } | null = null;

  get configured(): boolean {
    return process.env.EMAIL_ENABLED === 'true' && !!process.env.SMTP_HOST;
  }

  /** 惰性构建 SMTP transport（仅配置齐全时；失败返回 null 并记日志） */
  private async transport(): Promise<{ send: (input: MailInput) => Promise<unknown> } | null> {
    if (!this.configured) return null;
    if (this.cachedTransport) return this.cachedTransport;
    try {
      // 动态引入：未配置 SMTP 的部署不加载 nodemailer
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: process.env.SMTP_SECURE !== 'false',
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });
      this.cachedTransport = {
        send: (input) =>
          transporter.sendMail({
            from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
          }),
      };
      return this.cachedTransport;
    } catch (error) {
      this.logger.error(
        `SMTP transport 构建失败，邮件未投递：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async send(input: MailInput): Promise<MailResult> {
    const transport = await this.transport();
    if (!transport) {
      return {
        delivered: false,
        reason: this.configured ? 'transport_unavailable' : 'email_disabled',
      };
    }
    try {
      await transport.send(input);
      return { delivered: true };
    } catch (error) {
      this.logger.error(
        `邮件投递失败（to=${input.to}）：${error instanceof Error ? error.message : String(error)}`,
      );
      return { delivered: false, reason: 'send_failed' };
    }
  }
}
