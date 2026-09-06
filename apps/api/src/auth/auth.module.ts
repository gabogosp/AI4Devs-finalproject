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
import { AuthEventsService } from '../observability/auth-events.service';

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
        // §7.3 — tercer throttler nombrado: la superficie del carrito (US-007),
        // primera pública de ESCRITURA. El `limit` de acá es el de lectura; las
        // escrituras lo bajan con `@Throttle({ cart: { limit: … } })` en el
        // handler, porque cada una crea o modifica filas.
        {
          name: 'cart',
          ttl: config.get<number>('CART_RATE_LIMIT_TTL_MS', 60_000),
          limit: config.get<number>('CART_RATE_LIMIT_MAX', 120),
        },
        // §7.3 — cuarto throttler nombrado: el enriquecimiento IA (US-005). Es la única
        // superficie donde un request de más cuesta **plata** (llamadas pagas al proveedor).
        //
        // El `limit` de acá es un techo deliberadamente inalcanzable, y el presupuesto real
        // (`ENRICHMENT_RATE_LIMIT_MAX`, 6/min) va como `@Throttle({ enrichment: … })` en el
        // handler. La razón es concreta: `@nestjs/throttler` aplica **todos** los throttlers
        // nombrados a **toda** ruta guardada, así que un tope chico acá se lo impondría
        // también al storefront, al carrito y a auth — pasó, y rompió 8 suites. La
        // alternativa era un `@SkipThrottle({ enrichment: true })` en cada controller ya
        // existente y en todos los futuros; esto no se puede olvidar.
        {
          name: 'enrichment',
          ttl: Number(config.get('ENRICHMENT_RATE_LIMIT_TTL_MS') ?? 60_000),
          limit: Number.MAX_SAFE_INTEGER,
        },
        // §7.3 — quinto throttler nombrado: la búsqueda semántica (US-004). Es la única
        // superficie PÚBLICA donde un request de más puede costar plata en un tercero.
        //
        // Mismo criterio que `enrichment` y por la misma razón medida: `@nestjs/throttler`
        // aplica TODOS los throttlers nombrados a TODA ruta guardada, así que un tope chico
        // acá se lo impondría al storefront, al carrito y a auth. El techo de acá es
        // inalcanzable y el presupuesto real (SEARCH_RATE_LIMIT_MAX, 20/min) va en el
        // `@Throttle` del handler.
        {
          name: 'search',
          ttl: Number(config.get('SEARCH_RATE_LIMIT_TTL_MS') ?? 60_000),
          limit: Number.MAX_SAFE_INTEGER,
        },
        // §7.3 — sexto throttler nombrado: el checkout (US-008). Mismo criterio
        // que `enrichment`/`search`: el `limit` de acá es un techo deliberadamente
        // inalcanzable, y el presupuesto real (`CHECKOUT_RATE_LIMIT_MAX`, 10/10min)
        // va como `@Throttle({ checkout: … })` en el único handler del checkout —
        // así ningún controller existente necesita un `@SkipThrottle({ checkout: true })`.
        {
          name: 'checkout',
          ttl: config.get<number>('CHECKOUT_RATE_LIMIT_TTL_MS', 600_000),
          limit: Number.MAX_SAFE_INTEGER,
        },
        // §7.3 — séptimo throttler nombrado: el medio simulado de pagos (US-010 D7).
        // Mismo criterio que `checkout`: techo inalcanzable acá, presupuesto real
        // (`PAYMENTS_SIMULATE_RATE_LIMIT_MAX`, 10/10min) en el `@Throttle` del handler.
        {
          name: 'payments_simulate',
          ttl: config.get<number>('PAYMENTS_SIMULATE_RATE_LIMIT_TTL_MS', 600_000),
          limit: Number.MAX_SAFE_INTEGER,
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
    AuthEventsService,
    // El adapter de email se elige por entorno (T7.2): Resend con clave, log sin
    // ella. En producción, faltar la clave hace fallar el arranque (envSchema).
    passwordResetMailerProvider,
  ],
  exports: [AdminGuard, AdminAuthService, JwtModule, CustomerGuard, AuthEventsService],
})
export class AuthModule {}
