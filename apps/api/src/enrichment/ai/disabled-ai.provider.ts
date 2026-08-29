import { Injectable } from '@nestjs/common';
import { AiDisabledError } from '../../common/errors/enrichment-errors';
import { AiEmbedder, AiEnricher } from '../../ai/ports/ai.ports';

/**
 * Proveedor de IA **deshabilitado** (US-005 T1.4, D6 del `design.md`).
 *
 * Es lo que se inyecta cuando no hay `GEMINI_API_KEY` o cuando
 * `ENRICHMENT_ENABLED=false`. Falla **explícito y sin red**: cada método lanza
 * `AiDisabledError`, el `/status` del enriquecimiento reporta `disabled` y el catálogo
 * queda navegable por categoría (AC-5).
 *
 * Lo que deliberadamente **no** hace, y es la decisión de fondo: devolver vectores
 * sintéticos. Un embedding falso hace que la búsqueda semántica «funcione» devolviendo
 * basura plausible, y eso no se descubre en un test — se descubre en la demo, con el
 * cliente mirando. Un fallo ruidoso es más barato que un resultado mentiroso.
 */
@Injectable()
export class DisabledAiProvider implements AiEmbedder, AiEnricher {
  /**
   * Lo que hace que el runner ni arranque: sin proveedor no hay corrida, y por lo tanto no
   * hay intentos fallidos acumulados en productos que están perfectamente bien.
   */
  readonly available = false;

  /** No hay modelo: nada se persiste con este proveedor. */
  readonly modelVersion = 'disabled';

  /**
   * Los parámetros no se declaran porque no se usan: el método falla antes de mirarlos.
   * Las firmas siguen siendo compatibles con los puertos (TypeScript permite implementar
   * con menos parámetros de los que declara la interfaz).
   */
  async embed(): Promise<number[]> {
    throw new AiDisabledError();
  }

  async enrich(): Promise<string> {
    throw new AiDisabledError();
  }
}
