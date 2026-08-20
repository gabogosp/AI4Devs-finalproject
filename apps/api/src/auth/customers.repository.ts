import { Injectable } from '@nestjs/common';
import { Customer } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma-errors';
import { RegistrationFailedError } from './auth-errors';
import { normalizeEmail } from './email/normalize-email';

export interface CreateCustomerData {
  email: string;
  name: string;
  phone?: string | null;
  passwordHash: string;
}

/**
 * Vista del cliente **sin** `password_hash`. Es el tipo que sale del repositorio
 * hacia arriba: si el hash no está en el tipo, no puede filtrarse a una respuesta
 * por descuido de serialización (AC-8).
 */
export type SafeCustomer = Omit<Customer, 'password_hash'>;

/** Único método que devuelve el hash, y sólo para verificarlo en el login. */
export type CustomerWithHash = Customer;

function stripHash(customer: Customer): SafeCustomer {
  const { password_hash: _hash, ...resto } = customer;
  return resto;
}

/**
 * Único punto de acceso al ORM para `customers` (§5).
 *
 * Dos invariantes que sostiene esta clase y de las que dependen los AC:
 *
 * 1. **El email se normaliza acá**, siempre, en escritura y en lectura. No se
 *    confía en que el DTO ya lo hizo: si un llamador nuevo olvidara normalizar,
 *    el UNIQUE dejaría entrar un duplicado.
 * 2. **`deleted_at IS NULL` en toda lectura de identidad.** La columna existe
 *    desde T0.2 aunque todavía no haya endpoint que la escriba (`Deferred:
 *    US-020`). Filtrar desde ahora hace que el día que US-020 la escriba, el
 *    login ya la respete — en vez de descubrir que las cuentas borradas seguían
 *    entrando.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCustomerData): Promise<SafeCustomer> {
    try {
      const creado = await this.prisma.customer.create({
        data: {
          email: normalizeEmail(data.email),
          name: data.name,
          phone: data.phone ?? null,
          password_hash: data.passwordHash,
        },
      });
      return stripHash(creado);
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        // Se traduce a un error genérico, no a un ConflictError que diga "email
        // duplicado": el mensaje que llega al cliente no debe confirmar que la
        // dirección ya está registrada (AC-6).
        throw new RegistrationFailedError();
      }
      throw error;
    }
  }

  /**
   * Devuelve el cliente **con** el hash — es el único camino que lo necesita, el
   * de verificar credenciales. Todo lo demás usa los métodos `Safe`.
   */
  findActiveByEmailWithHash(email: string): Promise<CustomerWithHash | null> {
    return this.prisma.customer.findFirst({
      where: { email: normalizeEmail(email), deleted_at: null },
    });
  }

  async findActiveByEmail(email: string): Promise<SafeCustomer | null> {
    const encontrado = await this.findActiveByEmailWithHash(email);
    return encontrado ? stripHash(encontrado) : null;
  }

  async findActiveById(id: string): Promise<SafeCustomer | null> {
    const encontrado = await this.prisma.customer.findFirst({
      where: { id, deleted_at: null },
    });
    return encontrado ? stripHash(encontrado) : null;
  }

  /**
   * Suma un intento fallido y devuelve el contador resultante, para que el
   * service decida si corresponde bloquear. El incremento es atómico (`increment`
   * de Prisma, no leer-sumar-escribir): dos intentos concurrentes contra la misma
   * cuenta no deben perder uno de los dos, que es justo lo que haría un atacante
   * paralelizando para no gastar el presupuesto de bloqueo.
   */
  async registerFailedLogin(id: string): Promise<number> {
    const actualizado = await this.prisma.customer.update({
      where: { id },
      data: { failed_login_attempts: { increment: 1 } },
      select: { failed_login_attempts: true },
    });
    return actualizado.failed_login_attempts;
  }

  /** Aplica el bloqueo temporal calculado por el service (backoff, T3.2). */
  async lockUntil(id: string, hasta: Date, lockoutCount: number): Promise<void> {
    await this.prisma.customer.update({
      where: { id },
      data: {
        locked_until: hasta,
        lockout_count: lockoutCount,
        failed_login_attempts: 0,
      },
    });
  }

  /**
   * Login exitoso: limpia el contador y el bloqueo, y sella `last_login_at`.
   *
   * `lockout_count` **no** se limpia acá: es la memoria del backoff. Si se
   * reseteara con cada login exitoso, un atacante alternaría intentos fallidos
   * con un login válido de una cuenta propia para mantener el castigo en el
   * mínimo. Se limpia sola por el paso del tiempo (T3.2).
   */
  async resetLoginFailures(id: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
      },
    });
  }

  /**
   * Cambia la contraseña y sella `password_changed_at` — ese timestamp es lo que
   * permite invalidar los access tokens emitidos antes del cambio (T3.4).
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.customer.update({
      where: { id },
      data: {
        password_hash: passwordHash,
        password_changed_at: new Date(),
        failed_login_attempts: 0,
        locked_until: null,
      },
    });
  }
}
