import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { CartModule } from '../cart/cart.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountThrottlerGuard } from './account-throttler.guard';
import { AccountEventsService } from '../observability/account-events.service';

/**
 * Módulo del borrado de cuenta (US-020, `design.md` §Context). Vive AFUERA de
 * `AuthModule` a propósito: la dirección real de dependencias en este repo es
 * `CheckoutModule → AuthModule` (`checkout.module.ts` importa `AuthModule`
 * para sus guards), así que un módulo nuevo que necesite AMBOS `AuthModule` y
 * `CheckoutModule`/`CartModule` no puede vivir dentro de `AuthModule` sin
 * cerrar un ciclo — mismo problema y misma solución que `OrdersModule`
 * (US-012/US-015, ver su propio comentario "orders → checkout, checkout no
 * conoce orders").
 *
 * Importa `AuthModule` por `CustomerGuard`/`CsrfGuard`/`CustomersRepository`/
 * `RefreshTokensRepository`/`PasswordResetTokensRepository` (T4.3 los agregó
 * a sus exports); `CheckoutModule` por `OrdersRepository`; `CartModule` por
 * `CartsRepository`. Ninguno de los tres re-declara su propio acceso al ORM
 * (§5) — este módulo sólo orquesta.
 */
@Module({
  imports: [PrismaModule, AuthModule, CheckoutModule, CartModule],
  controllers: [AccountController],
  providers: [AccountDeletionService, AccountThrottlerGuard, AccountEventsService],
})
export class AccountModule {}
