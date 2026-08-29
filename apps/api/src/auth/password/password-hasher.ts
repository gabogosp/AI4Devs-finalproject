import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

/**
 * Primitiva de credenciales — `security-standards.md` §3.1.
 *
 * Tres reglas que no se negocian acá:
 *
 * 1. **cost ≥ 12** (`BCRYPT_COST`, validado al arranque). El costo va en el hash,
 *    así que subirlo después no invalida los existentes: se rehashea al próximo
 *    login exitoso.
 * 2. **La comparación la hace bcrypt**, nunca `===`. `bcrypt.compare` es de
 *    tiempo constante respecto del contenido; comparar strings filtra por
 *    timing cuántos caracteres coincidieron.
 * 3. **Hash señuelo**: cuando el email no existe, el login igual consume un
 *    `bcrypt.compare` real contra un hash descartable. Sin esto, "email
 *    inexistente" responde en microsegundos y "contraseña incorrecta" en ~250 ms
 *    — y esa diferencia **es** el oráculo de enumeración que AC-5 y AC-11
 *    prometen no dar. El 401 genérico no alcanza por sí solo: el reloj habla.
 */
@Injectable()
export class PasswordHasher {
  private readonly cost: number;

  /**
   * Se calcula una vez al construir el servicio, no por request: un
   * `bcrypt.hash` de cost 12 cuesta ~250 ms y pagarlo en cada login inexistente
   * convertiría el señuelo en un vector de DoS.
   */
  private readonly dummyHash: string;

  constructor(config: ConfigService) {
    this.cost = config.get<number>('BCRYPT_COST') ?? 12;
    this.dummyHash = bcrypt.hashSync(
      randomBytes(32).toString('hex'),
      this.cost,
    );
  }

  /** Hashea una contraseña en claro. El salt lo genera bcrypt, por contraseña. */
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  /** Verifica en tiempo constante. `false` ante cualquier hash malformado. */
  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      // Un hash corrupto en la base no debe tumbar el login ni distinguirse de
      // una contraseña incorrecta.
      return false;
    }
  }

  /**
   * Consume el mismo trabajo que un `verify` fallido y devuelve **siempre**
   * `false`. Se llama cuando no hay usuario que verificar, para que el costo
   * observable del login no dependa de si el email existe.
   */
  async verifyDummy(plain: string): Promise<false> {
    await bcrypt.compare(plain, this.dummyHash);
    return false;
  }

  /**
   * `true` si el hash quedó por debajo del costo vigente — el llamador rehashea
   * tras un login exitoso, que es el único momento donde tiene la contraseña en
   * claro para hacerlo.
   */
  needsRehash(hash: string): boolean {
    return bcrypt.getRounds(hash) < this.cost;
  }
}
