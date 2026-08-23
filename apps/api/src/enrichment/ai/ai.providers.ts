import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_EMBEDDER, AI_ENRICHER, AiEmbedder, AiEnricher } from '../ports/ai.ports';
import { DisabledAiProvider } from './disabled-ai.provider';
import { GeminiHttpClient } from './gemini-http.client';

/**
 * Selección del proveedor de IA por configuración (US-005 T1.4) —
 * `backend-node-standards.md` §3, mismo patrón que `passwordResetMailerProvider` de
 * US-014.
 *
 * Dos condiciones y una sola salida segura:
 * - sin `GEMINI_API_KEY` **o** con `ENRICHMENT_ENABLED=false` ⇒ `DisabledAiProvider`
 *   (falla explícito, cero llamadas de red);
 * - con clave y habilitado ⇒ `GeminiHttpClient`.
 *
 * La salvaguarda contra la degradación silenciosa vive en `envSchema` (`superRefine`): en
 * **producción**, faltar la clave hace fallar el arranque. Así que si el proceso llegó a
 * esta línea sin clave, es porque no está en producción — y el warn deja el rastro.
 *
 * Los dos puertos resuelven a la **misma instancia**: es un solo cliente HTTP con un solo
 * limitador de RPM, y la cuota del free tier es compartida entre embeddings y texto.
 * Instanciarlos por separado duplicaría el presupuesto de RPM en la práctica.
 */
function crearProveedor(config: ConfigService): AiEmbedder & AiEnricher {
  const apiKey = config.get<string>('GEMINI_API_KEY');
  const habilitado = config.get<string>('ENRICHMENT_ENABLED', 'true') === 'true';
  const logger = new Logger('AiProvider');

  if (!apiKey) {
    logger.warn(
      'GEMINI_API_KEY ausente: el enriquecimiento queda DESHABILITADO. El catálogo no genera descripciones ni embeddings; sigue navegable por categoría (AC-5).',
    );
    return new DisabledAiProvider();
  }
  if (!habilitado) {
    logger.warn(
      'ENRICHMENT_ENABLED=false: el enriquecimiento queda DESHABILITADO por configuración.',
    );
    return new DisabledAiProvider();
  }

  return new GeminiHttpClient(config);
}

/**
 * Cache por `ConfigService` para que los dos tokens compartan instancia sin depender del
 * orden en que Nest los resuelva.
 */
const instancias = new WeakMap<ConfigService, AiEmbedder & AiEnricher>();

function obtener(config: ConfigService): AiEmbedder & AiEnricher {
  const existente = instancias.get(config);
  if (existente) return existente;
  const nuevo = crearProveedor(config);
  instancias.set(config, nuevo);
  return nuevo;
}

export const aiEmbedderProvider: Provider = {
  provide: AI_EMBEDDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AiEmbedder => obtener(config),
};

export const aiEnricherProvider: Provider = {
  provide: AI_ENRICHER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AiEnricher => obtener(config),
};

/** Los dos providers, para registrarlos de una en el módulo. */
export const aiProviders: Provider[] = [aiEmbedderProvider, aiEnricherProvider];
