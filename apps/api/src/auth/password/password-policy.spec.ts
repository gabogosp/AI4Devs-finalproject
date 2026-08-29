import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusSize, validatePassword } from './password-policy';

/**
 * T1.2 — política de contraseña (§3.2). La mitad de estos tests verifican que la
 * política **no** rechace lo que no debe: una política demasiado estricta empuja
 * a los usuarios hacia contraseñas peores, que es el fallo que §3.2 evita.
 */
describe('validatePassword (§3.2)', () => {
  describe('rechaza', () => {
    it('menos de 8 caracteres, aunque tenga mayúscula, dígito y símbolo', () => {
      expect(validatePassword('aB3!')).toContain('too_short');
    });

    it('más de 72 bytes — bcrypt truncaría en silencio (§3.1)', () => {
      expect(validatePassword('a'.repeat(73))).toContain('too_long_bytes');
    });

    it('el límite es en BYTES: 40 caracteres "ñ" son 80 bytes', () => {
      const passwd = 'ñ'.repeat(40);
      expect(passwd.length).toBe(40); // pasaría un chequeo por caracteres
      expect(Buffer.byteLength(passwd, 'utf8')).toBe(80);
      expect(validatePassword(passwd)).toContain('too_long_bytes');
    });

    it('contraseñas del corpus de filtradas', () => {
      expect(validatePassword('password')).toContain('breached');
      expect(validatePassword('123456789')).toContain('breached');
      expect(validatePassword('qwertyuiop')).toContain('breached');
    });

    it('el corpus se compara sin distinguir mayúsculas', () => {
      expect(validatePassword('PassWord')).toContain('breached');
    });

    it('la vacía', () => {
      expect(validatePassword('')).toEqual(['empty']);
    });

    it('devuelve TODAS las violaciones, no sólo la primera', () => {
      // Corta y filtrada a la vez: el usuario debe enterarse de las dos.
      expect(validatePassword('password'.slice(0, 8))).toContain('breached');
      const cortaYFiltrada = validatePassword('123456');
      expect(cortaYFiltrada).toContain('too_short');
      expect(cortaYFiltrada).toContain('breached');
    });
  });

  describe('acepta — sin reglas de composición (§3.2)', () => {
    it('una passphrase con espacios y sin dígitos ni símbolos ni mayúsculas', () => {
      expect(validatePassword('correo caballo batería grapa')).toEqual([]);
    });

    it('sólo minúsculas, si es suficientemente larga', () => {
      expect(validatePassword('abcdefghijklmnop')).toEqual([]);
    });

    it('Unicode y emoji, mientras entren en 72 bytes', () => {
      expect(validatePassword('日本語のパスワード')).toEqual([]);
      expect(validatePassword('contraseña🔐segura')).toEqual([]);
    });

    it('exactamente 8 caracteres (el mínimo es inclusivo)', () => {
      expect(validatePassword('xkcd-9r7q')).toEqual([]);
    });

    it('exactamente 72 bytes (el máximo es inclusivo)', () => {
      const passwd = 'z'.repeat(72);
      expect(Buffer.byteLength(passwd, 'utf8')).toBe(72);
      expect(validatePassword(passwd)).toEqual([]);
    });
  });

  describe('corpus', () => {
    it('tiene al menos 10 000 entradas', () => {
      expect(corpusSize()).toBeGreaterThanOrEqual(10_000);
    });

    it('declara su fuente en la cabecera — un corpus sin procedencia no es auditable', () => {
      const contenido = readFileSync(
        join(__dirname, 'breached-passwords.txt'),
        'utf-8',
      );
      expect(contenido).toMatch(/^# Corpus offline/);
      expect(contenido).toContain('SecLists');
      expect(contenido).toContain('https://github.com/');
    });

    it('los comentarios de la cabecera no entran como contraseñas', () => {
      expect(validatePassword('# Corpus offline')).not.toContain('breached');
    });
  });
});
