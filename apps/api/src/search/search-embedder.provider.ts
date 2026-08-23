import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DisabledAiProvider } from '../enrichment/ai/disabled-ai.provider';
import { GeminiHttpClient } from '../enrichment/ai/gemini-http.client';
import { AiEmbedder } from '../ai/ports/ai.ports';
import { configNumber } from '../enrichment/config-number';

/**
 * Token del embedder **del camino interactivo** (US-004 T1.2).
 *
 * Es un token distinto de `AI_EMBEDDER` a propósito, y no una segunda interfaz: el
 * **contrato** es el mismo (`AiEmbedder`), lo que cambia es la **instancia** y con ella su
 * presupuesto de tasa y su timeout. Dos tokens hacen explícito en el grafo de dependencias que
 * son dos colas distintas; un solo token compartido volvería a meter la búsqueda detrás de la
 * fila del lote, que es justamente lo que D2 evita.
 */
export const SEARCH_EMBEDDER = Symbol('SEARCH_EMBEDDER');

/**
 * Resuelve el embedder de consultas según la configuración, con **dos** motivos de
 * indisponibilidad y no uno:
 *
 * 1. **Sin `GEMINI_API_KEY`** — igual que en US-005: no hay proveedor con el que trabajar.
 * 2. **Con `GEMINI_SEARCH_MAX_RPM = 0`** — hay clave, pero el operador le dio *toda* la cuota
 *    al enriquecimiento (el caso de la primera corrida del catálogo, runbook §3.6). No es una
 *    falla: es una decisión, y la búsqueda tiene que responder por full-text sin intentar una
 *    llamada que no tiene presupuesto.
 *
 * Los dos casos se expresan con el mismo mecanismo que US-005 ya tenía —`available: false` del
 * puerto— así que el servicio de búsqueda no necesita saber **por qué** no hay embedder: sólo
 * que no lo hay, y que eso significa degradar. Un `if (!apiKey)` en el service sería la misma
 * regla escrita dos veces y en el lugar equivocado.
 */
export const searchEmbedderProvider: Provider = {
  provide: SEARCH_EMBEDDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AiEmbedder => {
    const logger = new Logger('SearchEmbedderProvider');
    const apiKey = config.get<string>('GEMINI_API_KEY');
    const rpm = configNumber(config, 'GEMINI_SEARCH_MAX_RPM', 10);

    if (!apiKey) {
      logger.warn(
        'GEMINI_API_KEY ausente: la búsqueda semántica queda DEGRADADA a full-text. El catálogo sigue buscable por texto (AC-4).',
      );
      return new DisabledAiProvider() as unknown as AiEmbedder;
    }
    if (rpm <= 0) {
      logger.warn(
        'GEMINI_SEARCH_MAX_RPM=0: toda la cuota del proveedor está asignada al enriquecimiento, así que la búsqueda responde por full-text. Es la configuración de la primera corrida del catálogo (runbook §3.6), no una falla.',
      );
      return new DisabledAiProvider() as unknown as AiEmbedder;
    }

    // Perfil `interactive`: su propio limitador (GEMINI_SEARCH_MAX_RPM) y su propio timeout
    // (GEMINI_SEARCH_TIMEOUT_MS), en una instancia separada de la del enriquecimiento.
    return new GeminiHttpClient(config, undefined, {}, 'interactive');
  },
};
