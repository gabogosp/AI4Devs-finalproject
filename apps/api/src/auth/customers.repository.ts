import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@dsm/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../common/prisma-errors';
import { RegistrationFailedError } from '../common/errors/auth-errors';
import { normalizeEmail } from './email/normalize-email';
import {
  ANONYMIZED_CUSTOMER_NAME,
  ANONYMIZED_CUSTOMER_PHONE,
  anonymizedCustomerEmail,
} from './customer-anonymization';

/**
 * Rol de todo cliente que se registra por la vía pública.
 *
 * `CreateCustomerData` **no tiene** campo `role`, así que no hay un valor del
 * request que filtrar: es estructuralmente imposible que llegue uno. El valor lo
 * escribe el repositorio de forma explícita, y no se deja al `@default` del
 * esquema: si alguien cambiara ese default, el registro empezaría a emitir otro
 * rol sin que nada acá se entere.
 */
export const ROL_CLIENTE = 'customer';

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta a propósito
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
          role: ROL_CLIENTE,
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

  /**
   * Borrado de cuenta (US-020): anonimiza la fila y sella `deleted_at`.
   * `password_hash` queda intacto — no hay lectura que lo devuelva (`SafeCustomer`
   * lo excluye del tipo) y no forma parte de la superficie de PII de este US
   * (`design.md` §Trade-offs).
   *
   * Guardado por `deleted_at: null` en el WHERE, mismo idioma que
   * `OrdersRepository.anonymize` — `count === 0` es AC-15 (idempotencia): la
   * cuenta ya estaba borrada (o el id no existe), y el caller lo interpreta
   * como "no hacer nada más", no como error. Acepta `tx`: siempre corre dentro
   * de la transacción de `AccountDeletionService.deleteAccount`.
   */
  async anonymize(
    id: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SafeCustomer | null> {
    const { count } = await tx.customer.updateMany({
      where: { id, deleted_at: null },
      data: {
        name: ANONYMIZED_CUSTOMER_NAME,
        phone: ANONYMIZED_CUSTOMER_PHONE,
        email: anonymizedCustomerEmail(id),
        deleted_at: new Date(),
      },
    });
    if (count === 0) return null;
    const actualizado = await tx.customer.findUniqueOrThrow({ where: { id } });
    return stripHash(actualizado);
  }

  /**
   * Edición de perfil (US-024): `name` + `avatar_url`. Mismo idioma guardado
   * que `anonymize()` — `updateMany` con `deleted_at: null` en el WHERE,
   * `count === 0` es "cuenta no activa o id inexistente" y el caller
   * (`AccountController`) lo trata como sesión inválida, no como error de
   * validación.
   */
  async updateProfile(
    id: string,
    data: { name: string; avatar_url: string | null },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SafeCustomer | null> {
    const { count } = await tx.customer.updateMany({
      where: { id, deleted_at: null },
      data: { name: data.name, avatar_url: data.avatar_url },
    });
    if (count === 0) return null;
    const actualizado = await tx.customer.findUniqueOrThrow({ where: { id } });
    return stripHash(actualizado);
  }
}
