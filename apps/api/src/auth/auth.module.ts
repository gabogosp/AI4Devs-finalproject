import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';

/**
 * Módulo del seam de auth admin (ADR-0009). Expone `POST /v1/admin/auth/login`
 * (la costura que consume el panel), y exporta `AdminGuard` (consumido por los
 * controllers admin) y `AdminAuthService` (emisión interina del token).
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminGuard, AdminAuthService],
  exports: [AdminGuard, AdminAuthService, JwtModule],
})
export class AuthModule {}
