import { hashToken, newToken } from './opaque-token';

describe('opaque-token (§3.7)', () => {
  describe('newToken', () => {
    it('1 000 tokens sin una sola colisión', () => {
      const vistos = new Set<string>();
      for (let i = 0; i < 1_000; i++) vistos.add(newToken());
      expect(vistos.size).toBe(1_000);
    });

    it('≥ 256 bits de entropía: 43 chars base64url sin padding', () => {
      const token = newToken();
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(token).not.toContain('=');
    });

    it('base64url: viaja en cookie, URL y header sin escapar', () => {
      for (let i = 0; i < 100; i++) {
        expect(newToken()).toMatch(/^[A-Za-z0-9_-]+$/);
      }
      // El alfabeto estándar usaría '+' y '/', que en una URL de reset se
      // romperían al no escaparse — el enlace del email dejaría de funcionar
      // para una fracción de los tokens, de forma intermitente.
    });
  });

  describe('hashToken', () => {
    it('determinista y de 64 hex', () => {
      const token = newToken();
      const hash = hashToken(token);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hashToken(token)).toBe(hash);
    });

    it('claros distintos dan hashes distintos', () => {
      expect(hashToken(newToken())).not.toBe(hashToken(newToken()));
    });

    it('no es reversible al claro — es lo que hace segura la fila en la base', () => {
      const token = newToken();
      expect(hashToken(token)).not.toContain(token);
    });

    it('un cambio de un caracter cambia el hash entero', () => {
      const a = 'abcdefghijklmnopqrstuvwxyz012345';
      const b = 'abcdefghijklmnopqrstuvwxyz012346';
      const [ha, hb] = [hashToken(a), hashToken(b)];
      const iguales = [...ha].filter((c, i) => c === hb[i]).length;
      expect(iguales).toBeLessThan(20); // de 64: sin prefijo común explotable
    });
  });
});
