import { ConfigService } from '@nestjs/config';
import { PasswordHasher } from './password-hasher';

/**
 * T1.1 — primitiva de credenciales (`security-standards.md` §3.1).
 *
 * Estos tests no verifican "que bcrypt funcione" (eso lo verifica bcrypt). Anclan
 * las tres propiedades de las que dependen los AC: costo ≥ 12, salt por
 * contraseña, y que el señuelo cueste lo mismo que un fallo real.
 */
const hasher = new PasswordHasher(
  new ConfigService({ BCRYPT_COST: 12 }) as ConfigService,
);

describe('PasswordHasher (§3.1)', () => {
  it('hashea con el costo del entorno: el prefijo lo declara', async () => {
    const hash = await hasher.hash('correo caballo batería grapa');
    expect(hash.startsWith('$2b$12$')).toBe(true);
  });

  it('salt por contraseña: la misma entrada da hashes distintos', async () => {
    // Si dos hashes de la misma contraseña coincidieran, una tabla precomputada
    // rompería toda la base de una vez.
    const [a, b] = await Promise.all([
      hasher.hash('la misma contraseña'),
      hasher.hash('la misma contraseña'),
    ]);
    expect(a).not.toBe(b);
    expect(await hasher.verify('la misma contraseña', a)).toBe(true);
    expect(await hasher.verify('la misma contraseña', b)).toBe(true);
  });

  it('verify: true sólo con la contraseña correcta', async () => {
    const hash = await hasher.hash('contraseña-correcta');
    expect(await hasher.verify('contraseña-correcta', hash)).toBe(true);
    expect(await hasher.verify('contraseña-incorrecta', hash)).toBe(false);
    expect(await hasher.verify('', hash)).toBe(false);
  });

  it('un hash corrupto en la base no distingue del fallo normal ni explota', async () => {
    expect(await hasher.verify('lo que sea', 'no-es-un-hash')).toBe(false);
  });

  it('verifyDummy siempre devuelve false', async () => {
    expect(await hasher.verifyDummy('cualquier cosa')).toBe(false);
    expect(await hasher.verifyDummy('')).toBe(false);
  });

  it('verifyDummy cuesta lo mismo que un verify fallido — el reloj no delata si el email existe', async () => {
    const hash = await hasher.hash('la contraseña del usuario real');

    const t0 = process.hrtime.bigint();
    await hasher.verify('contraseña incorrecta', hash);
    const fallidoReal = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    await hasher.verifyDummy('contraseña incorrecta');
    const senuelo = Number(process.hrtime.bigint() - t1) / 1e6;

    // Umbral deliberadamente laxo (100% del tiempo del real): el punto es que el
    // señuelo esté en el **mismo orden de magnitud**, no que empate al ms. Un
    // señuelo que no hiciera trabajo real daría ~0 ms contra ~250 ms y fallaría
    // acá por varios órdenes; apretar el umbral sólo compraría flakiness de CI.
    expect(Math.abs(fallidoReal - senuelo)).toBeLessThan(fallidoReal);
    expect(senuelo).toBeGreaterThan(1);
  });

  it('needsRehash: detecta hashes por debajo del costo vigente', async () => {
    const masBarato = new PasswordHasher(
      new ConfigService({ BCRYPT_COST: 10 }) as ConfigService,
    );
    const viejo = await masBarato.hash('contraseña');
    expect(hasher.needsRehash(viejo)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash('contraseña'))).toBe(false);
  });

  it('la contraseña en claro no queda en ningún campo del objeto', async () => {
    const secreto = 'este-string-no-debe-quedar-guardado';
    await hasher.hash(secreto);
    expect(JSON.stringify(Object.entries(hasher))).not.toContain(secreto);
  });
});
