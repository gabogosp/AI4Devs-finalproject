import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminGuard } from './admin.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CredentialsService } from './credentials.service';
import { SessionService } from './session.service';
import { PasswordResetService } from './password-reset.service';
import { CustomersRepository } from './customers.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { PasswordResetTokensRepository } from './password-reset-tokens.repository';
import { PasswordHasher } from './password/password-hasher';
import { CustomerGuard } from './customer.guard';
import { CsrfGuard } from './csrf.guard';
import { passwordResetMailerProvider } from './mail/password-reset-mailer.provider';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Módulo del seam de auth admin (ADR-0009). Expone `POST /v1/admin/auth/login`
 * (la costura que consume el panel), y exporta `AdminGuard` (consumido por los
 * controllers admin) y `AdminAuthService` (emisión interina del token).
 */
@Module({
  imports: [
    PrismaModule,
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
  controllers: [AdminAuthController, CustomerAuthController],
  providers: [
    AdminGuard,
    AdminAuthService,
    AuthThrottlerGuard,
    // US-014 — repositorios, primitivas, services y guards del seam de cliente.
    CustomersRepository,
    RefreshTokensRepository,
    PasswordResetTokensRepository,
    PasswordHasher,
    CredentialsService,
    SessionService,
    CustomerAuthService,
    PasswordResetService,
    CustomerGuard,
    CsrfGuard,
    // El adapter de email se elige por entorno (T7.2): Resend con clave, log sin
    // ella. En producción, faltar la clave hace fallar el arranque (envSchema).
    passwordResetMailerProvider,
  ],
  exports: [AdminGuard, AdminAuthService, JwtModule, CustomerGuard],
})
export class AuthModule {}
