import { hashToken } from '../auth/tokens/opaque-token';
import { OrderTokenService } from './order-token.service';

/**
 * T2.2 — 1000 emisiones para las propiedades estadísticas (unicidad del claro
 * y del hash) y el formato exacto que el contrato de US-009 declara para
 * `order_token` (`pattern: '^[0-9a-f]{64}$'`).
 */
describe('OrderTokenService', () => {
  const service = new OrderTokenService();

  it('1000 emisiones producen 1000 claros distintos y 1000 hashes distintos', () => {
    const emisiones = Array.from({ length: 1000 }, () => service.issue());

    expect(new Set(emisiones.map((e) => e.token)).size).toBe(1000);
    expect(new Set(emisiones.map((e) => e.tokenHash)).size).toBe(1000);
  });

  it('el claro matchea el pattern hex de 64 que declara el contrato de US-009', () => {
    for (const { token } of Array.from({ length: 20 }, () => service.issue())) {
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('hashToken(token) reproduce exactamente el hash emitido', () => {
    const { token, tokenHash } = service.issue();
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('el claro no aparece en el objeto devuelto por ninguna otra vía que `token`', () => {
    const issued = service.issue();
    const claves = Object.keys(issued);

    expect(claves.sort()).toEqual(['token', 'tokenHash']);
    expect(issued.tokenHash).not.toBe(issued.token);
    // El hash no contiene el claro como substring (harían falta 256 bits de
    // casualidad) — cinturón y tirantes sobre la propiedad anterior.
    expect(issued.tokenHash).not.toContain(issued.token);
  });
});
