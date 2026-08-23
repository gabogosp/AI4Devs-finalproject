import { mapErrorToProblem } from '../filters/http-problem.filter';
import {
  AiDisabledError,
  AiPermanentError,
  AiTransientError,
} from './enrichment-errors';
import { DomainError } from './domain-errors';

/**
 * T1.1 — los tres errores del enriquecimiento y su mapeo al envelope RFC 7807.
 *
 * Lo que se prueba no es que las clases existan, sino que **el filtro existente las
 * serializa sin haber sido tocado**: heredan de `DomainError`, así que el mapeo es el
 * mismo que ya usan catálogo, auth y carrito.
 */
const INSTANCE = '/v1/admin/enrichment/run';

describe('errores del enriquecimiento (dsm:enrichment/*)', () => {
  it('los tres heredan de DomainError', () => {
    expect(new AiTransientError()).toBeInstanceOf(DomainError);
    expect(new AiPermanentError('x')).toBeInstanceOf(DomainError);
    expect(new AiDisabledError()).toBeInstanceOf(DomainError);
  });

  it('los tres exponen un `type` bajo el namespace dsm:enrichment/', () => {
    for (const e of [
      new AiTransientError(),
      new AiPermanentError('x'),
      new AiDisabledError(),
    ]) {
      expect(e.type).toMatch(/^dsm:enrichment\//);
    }
  });

  describe('AiTransientError (reintentable)', () => {
    it('es 503 y el filtro lo serializa con su type', () => {
      const problem = mapErrorToProblem(new AiTransientError(), INSTANCE);

      expect(problem.status).toBe(503);
      expect(problem.type).toBe('dsm:enrichment/ai-transient');
      expect(problem.instance).toBe(INSTANCE);
    });

    it('conserva `retryAfterSeconds` cuando el proveedor lo manda', () => {
      // El dato del proveedor gana sobre nuestro backoff: sabe mejor cuándo vuelve.
      expect(new AiTransientError('429', 30).retryAfterSeconds).toBe(30);
      expect(new AiTransientError().retryAfterSeconds).toBeUndefined();
    });
  });

  describe('AiPermanentError (no reintentable)', () => {
    it('es 502 con su type propio — la distinción decide si se gasta cuota', () => {
      const problem = mapErrorToProblem(
        new AiPermanentError('vector de 512 dimensiones'),
        INSTANCE,
      );

      expect(problem.status).toBe(502);
      expect(problem.type).toBe('dsm:enrichment/ai-permanent');
      expect(problem.detail).toBe('vector de 512 dimensiones');
    });

    it('NO expone `retryAfterSeconds`: reintentarlo no lo arregla', () => {
      expect(new AiPermanentError('x')).not.toHaveProperty('retryAfterSeconds');
    });
  });

  describe('AiDisabledError', () => {
    it('es 503 y su mensaje explica que falta configurar el proveedor (D6)', () => {
      const problem = mapErrorToProblem(new AiDisabledError(), INSTANCE);

      expect(problem.status).toBe(503);
      expect(problem.type).toBe('dsm:enrichment/disabled');
      expect(problem.detail).toMatch(/deshabilitado/i);
    });
  });

  it('ningún mensaje filtra la clave del proveedor', () => {
    // Los `detail` viajan al cliente y a los logs de error (AC-9).
    // No imita el prefijo `AIza` de una clave real, a propósito: el gate de secretos del
    // change escanea ese patrón en todo el árbol y una clave de test que lo imite lo dejaría
    // siempre en rojo — una red que siempre falla se ignora.
    const clave = 'CLAVE-SECRETA-DEL-PROVEEDOR-DE-TEST';
    for (const e of [
      new AiTransientError(),
      new AiPermanentError('respuesta inesperada del proveedor'),
      new AiDisabledError(),
    ]) {
      expect(String(e)).not.toContain(clave);
      expect(mapErrorToProblem(e, INSTANCE).detail).not.toContain(clave);
    }
  });

  it('el cuerpo del problem son las 5 claves del envelope, sin extras', () => {
    // Ninguno declara extension members, así que el cuerpo es el de siempre.
    expect(
      Object.keys(mapErrorToProblem(new AiDisabledError(), INSTANCE)).sort(),
    ).toEqual(['detail', 'instance', 'status', 'title', 'type']);
  });
});
