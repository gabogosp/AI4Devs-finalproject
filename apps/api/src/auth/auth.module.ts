import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';
import { AdminAuthService } from './admin-auth.service';

/**
 * Módulo del seam de auth admin (ADR-0009). Exporta `AdminGuard` (consumido por
 * los controllers admin) y `AdminAuthService` (emisión interina del token).
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [AdminGuard, AdminAuthService],
  exports: [AdminGuard, AdminAuthService, JwtModule],
})
export class AuthModule {}
