import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard } from './admin.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/**
 * Módulo del seam de auth admin (ADR-0009). Expone `POST /v1/admin/auth/login`
 * (la costura que consume el panel), y exporta `AdminGuard` (consumido por los
 * controllers admin) y `AdminAuthService` (emisión interina del token).
 */
@Module({
  imports: [
    JwtModule.register({}),
    // §7.3 — throttle por IP acotado a la superficie de auth. La ventana y el
    // límite salen de env (validados) para poder endurecerlos por entorno sin
    // tocar código; el resto de la API no queda limitada innecesariamente.
    // `AppConfigModule` registra ConfigModule con `isGlobal: true`, así que NO
    // se re-importa acá: un ConfigModule pelado provee un ConfigService sin
    // configurar y `get()` devolvería undefined (silenciosamente cae al default).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'auth',
          ttl: config.get<number>('AUTH_RATE_LIMIT_TTL_MS', 900_000),
          limit: config.get<number>('AUTH_RATE_LIMIT_MAX', 5),
        },
        // §7.3 — throttler nombrado de la superficie pública del storefront
        // (US-003). El `ThrottlerModule` es global y se registra una sola vez,
        // así que el array de throttlers vive acá; cada controller scopea el
        // suyo con `@SkipThrottle` del otro.
        {
          name: 'storefront',
          ttl: config.get<number>('STOREFRONT_RATE_LIMIT_TTL_MS', 60_000),
          limit: config.get<number>('STOREFRONT_RATE_LIMIT_MAX', 60),
        },
      ],
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminGuard, AdminAuthService, AuthThrottlerGuard],
  exports: [AdminGuard, AdminAuthService, JwtModule],
})
export class AuthModule {}
