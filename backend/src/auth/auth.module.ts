import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AdminController } from './admin.controller.js';
import { SessionAuthGuard } from './session.guard.js';
import { MailerService } from './mailer.service.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';

@Module({
  controllers: [AuthController, AdminController],
  providers: [AuthService, SessionAuthGuard, MailerService, AuthRateLimiter],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
