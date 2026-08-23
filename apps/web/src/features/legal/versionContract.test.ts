import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, LEGAL_TERMS_VERSION } from './content';

/**
 * US-017 T4.3 — la mitad de frontend de AC-8: **contrato de versión entre el sitio y el
 * backend**.
 *
 * Por qué es un test y no un párrafo de documentación: si el FE publica «versión 2026-06-15»
 * y el backend registra otra en `orders.consent_terms_version`, la orden afirma que la persona
 * aceptó una versión **que el sitio nunca publicó**. Ante un requerimiento de la Ley 25.326
 * eso es peor que no tener el registro: es un registro que contradice la evidencia. Un
 * contrato entre dos sistemas se verifica, no se documenta y se espera
 * (`documentation-standards.md` §11).
 *
 * **Desviación del `Pattern:` del plan, con motivo.** El plan leía
 * `apps/api/.env.example`, que **no existe**: este monorepo tiene un único `.env.example` en
 * la raíz (verificado al ejecutar). Se lee ese. La intención —verificar el contrato contra lo
 * que el backend declara— queda intacta; lo que cambió es de dónde se lee.
 *
 * **Fuente más fuerte, pendiente**: cuando US-008 T0.2 declare `LEGAL_TERMS_VERSION` en
 * `apps/api/src/config/env.validation.ts` con su default, ESA pasa a ser la fuente autoritativa
 * (el `.env.example` es documentación; el schema Zod es lo que el proceso valida al arrancar).
 * El test de abajo ya la compara si existe, así que el día que US-008 aterrice el contrato se
 * refuerza solo, sin tocar este archivo.
 * `Deferred: US-019 — que el valor configurado en Railway coincida.`
 */

const RAIZ_REPO = resolve(__dirname, '../../../../..');

function versionDeclaradaEnEnvExample(): string | undefined {
  const contenido = readFileSync(resolve(RAIZ_REPO, '.env.example'), 'utf8');
  return contenido.match(/^LEGAL_TERMS_VERSION=(.+)$/m)?.[1]?.trim();
}

function versionDeclaradaEnSchemaDelBackend(): string | undefined {
  // `env.validation.ts` es la fuente autoritativa cuando exista (US-008 T0.2).
  const ruta = resolve(RAIZ_REPO, 'apps/api/src/config/env.validation.ts');
  let contenido: string;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch {
    return undefined;
  }
  return contenido
    .match(/LEGAL_TERMS_VERSION[\s\S]{0,160}?\.default\(\s*['"]([^'"]+)['"]/)
    ?.[1]
    ?.trim();
}

describe('AC-8 — contrato de versión entre el sitio y el backend', () => {
  it('el backend declara la versión (si no, no hay contrato que verificar)', () => {
    // Es un FALLO y no un skip: la ausencia de la variable es exactamente el estado en
    // el que la orden registraría un default distinto sin que nadie se enterara.
    expect(versionDeclaradaEnEnvExample()).toBeDefined();
  });

  it('la versión publicada es la que el backend registra en la orden', () => {
    expect(versionDeclaradaEnEnvExample()).toBe(
      LEGAL_DOCUMENTS.terminos.version,
    );
  });

  it('los dos documentos publican la MISMA versión', () => {
    // Divergir entre privacidad y términos haría que `consent_terms_version` —que es un
    // solo campo en la orden— no pueda representar lo que la persona aceptó.
    expect(LEGAL_DOCUMENTS.privacidad.version).toBe(
      LEGAL_DOCUMENTS.terminos.version,
    );
    expect(LEGAL_TERMS_VERSION).toBe(LEGAL_DOCUMENTS.terminos.version);
  });

  it('cuando US-008 declare la versión en el schema Zod, también tiene que coincidir', () => {
    const enSchema = versionDeclaradaEnSchemaDelBackend();
    if (enSchema === undefined) {
      // US-008 T0.2 todavía no aterrizó. No se salta el caso en silencio: se asserta el
      // estado esperado HOY, así el test cambia de significado solo cuando el código
      // cambie, y no queda un `it.skip` que nadie vuelve a mirar.
      expect(versionDeclaradaEnEnvExample()).toBeDefined();
      return;
    }
    expect(enSchema).toBe(LEGAL_DOCUMENTS.terminos.version);
  });
});
