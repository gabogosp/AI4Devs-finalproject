import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiPermanentError,
  AiTransientError,
} from '../../common/errors/enrichment-errors';
import { AiEmbedder, AiEnricher, EnrichInput } from '../ports/ai.ports';

/** Dimensión del vector que fija el esquema (`vector(768)`). No es negociable acá. */
export const EMBEDDING_DIMS = 768;

/** Base de la API REST de Gemini. Inyectable para poder apuntarla a un stub en tests. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Prompt del enriquecedor — **constante versionada** (US-005 T1.2).
 *
 * Vive acá y no en base ni en env porque un cambio de prompt cambia el texto de todo el
 * catálogo: tiene que quedar en el historial de git, revisable en un diff, junto a la
 * versión del modelo que lo interpretó.
 *
 * Tres cosas que pide a propósito, y una que prohíbe:
 * - **Español rioplatense** y vocabulario de ferretería argentina (el comprador busca
 *   «tarugo», no «taco de expansión»).
 * - **Términos de uso y sinónimos**: es lo que hace que el embedding matchee «algo para
 *   colgar un cuadro en pared dura», que es el caso que abre el PRD.
 * - **Prohibido inventar especificaciones técnicas**: un LLM que completa «resistencia
 *   400 kg» sobre un producto que no la declara convierte el catálogo en un riesgo
 *   comercial. Si el dato no está en la entrada, no entra en la salida.
 */
export const ENRICH_PROMPT_V1 = [
  'Sos un experto en ferretería y refrigeración de Argentina.',
  'Escribí una descripción de producto para un e-commerce, en español rioplatense,',
  'en 2 o 3 oraciones, sin títulos ni listas ni markdown.',
  '',
  'Incluí:',
  '- para qué se usa el producto y en qué situaciones típicas,',
  '- los sinónimos y nombres populares con los que un cliente argentino lo pediría.',
  '',
  'Prohibido:',
  '- inventar especificaciones técnicas, medidas, materiales, potencias o marcas',
  '  que no estén en los datos que te doy,',
  '- inventar precios, stock, garantías o plazos de entrega,',
  '- prometer resultados o compatibilidades que no estén en los datos.',
  '',
  'Si los datos son pobres, describí el uso general de ese tipo de producto sin agregar',
  'especificaciones inventadas.',
].join('\n');

/** Versión del prompt, para trazar qué texto produjo qué corrida. */
export const ENRICH_PROMPT_VERSION = 'enrich-v1';

interface RespuestaEmbed {
  embedding?: { values?: unknown };
}

interface RespuestaGenerate {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
}

/**
 * Adapter REST de Gemini (US-005 T1.2) — implementa los dos puertos.
 *
 * Cuatro reglas que sostienen este archivo:
 *
 * 1. **La clave va en el header `x-goog-api-key`, nunca en la URL** (`security-standards`
 *    §5, AC-9). Los ejemplos oficiales de Gemini usan `?key=…`, y eso termina en el log
 *    de cualquier proxy, en el `instance` de un error y en una traza. Acá no.
 * 2. **Timeout explícito en toda llamada saliente** (`backend-node-standards` §8) con
 *    `AbortSignal.timeout`: sin él, una llamada colgada bloquea un slot de la corrida
 *    hasta el fin del proceso.
 * 3. **La respuesta se valida antes de devolverse** (`security-standards` §6). Un vector
 *    de 512 dimensiones, con `NaN` o de norma 0 es basura que la base aceptaría a medias
 *    y la búsqueda devolvería como resultado: se rechaza acá, con `AiPermanentError`.
 * 4. **Ningún error incluye la clave ni el prompt.** Los mensajes nombran el status y la
 *    forma del problema, nada más.
 */
@Injectable()
export class GeminiHttpClient implements AiEmbedder, AiEnricher {
  constructor(
    private readonly config: ConfigService,
    /** Inyectable para tests: apunta a un stub local en vez del proveedor real. */
    private readonly baseUrl: string = GEMINI_BASE_URL,
  ) {}

  get modelVersion(): string {
    return this.config.get<string>('GEMINI_EMBED_MODEL', 'text-embedding-004');
  }

  private get apiKey(): string {
    return this.config.getOrThrow<string>('GEMINI_API_KEY');
  }

  async embed(text: string): Promise<number[]> {
    const model = this.modelVersion;
    const timeout = this.config.get<number>('GEMINI_EMBED_TIMEOUT_MS', 10_000);

    const json = await this.post<RespuestaEmbed>(
      `${this.baseUrl}/v1beta/models/${model}:embedContent`,
      { content: { parts: [{ text }] } },
      timeout,
    );

    return this.validarVector(json.embedding?.values);
  }

  async enrich(input: EnrichInput): Promise<string> {
    const model = this.config.get<string>(
      'GEMINI_ENRICH_MODEL',
      'gemini-1.5-flash',
    );
    const timeout = this.config.get<number>('GEMINI_ENRICH_TIMEOUT_MS', 20_000);
    const maxChars = this.config.get<number>(
      'ENRICHMENT_MAX_ENRICHED_CHARS',
      1_200,
    );

    const datos = [
      `Producto: ${input.name}`,
      `Rubro: ${input.categoryName}`,
      `Descripción actual: ${input.baseText?.trim() || '(no hay)'}`,
    ].join('\n');

    const json = await this.post<RespuestaGenerate>(
      `${this.baseUrl}/v1beta/models/${model}:generateContent`,
      {
        contents: [{ parts: [{ text: `${ENRICH_PROMPT_V1}\n\n${datos}` }] }],
        generationConfig: { temperature: 0.4 },
      },
      timeout,
    );

    const texto = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof texto !== 'string' || texto.trim().length === 0) {
      // Una respuesta vacía no se arregla reintentando la misma entrada.
      throw new AiPermanentError(
        'el proveedor devolvió una descripción vacía o con otra forma',
      );
    }

    return this.recortar(texto.trim(), maxChars);
  }

  /**
   * Recorta al tope de caracteres **en el último final de oración** que quepa, y si no
   * hay ninguno, en el último espacio. Cortar a mitad de palabra deja un texto que se
   * lee roto en la ficha y que el embedder interpreta peor.
   */
  private recortar(texto: string, maxChars: number): string {
    if (texto.length <= maxChars) return texto;

    const cortado = texto.slice(0, maxChars);
    const finDeOracion = Math.max(
      cortado.lastIndexOf('. '),
      cortado.lastIndexOf('.\n'),
    );
    if (finDeOracion > maxChars * 0.5) return cortado.slice(0, finDeOracion + 1);

    const ultimoEspacio = cortado.lastIndexOf(' ');
    return `${(ultimoEspacio > 0 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
  }

  /** Valida forma, dimensión, finitud y norma del vector antes de devolverlo. */
  private validarVector(values: unknown): number[] {
    if (!Array.isArray(values)) {
      throw new AiPermanentError(
        'la respuesta del proveedor no trae un vector de embedding',
      );
    }
    if (values.length !== EMBEDDING_DIMS) {
      // El esquema declara vector(768): otra dimensión no es «casi correcto», es
      // inservible, y la base la rechazaría a medio camino de la corrida.
      throw new AiPermanentError(
        `el embedding tiene ${values.length} dimensiones y el esquema exige ${EMBEDDING_DIMS}`,
      );
    }
    if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new AiPermanentError(
        'el embedding contiene valores no finitos (NaN o Infinity)',
      );
    }
    const norma = Math.sqrt(
      (values as number[]).reduce((suma, v) => suma + v * v, 0),
    );
    if (norma === 0) {
      // Un vector nulo tiene distancia coseno indefinida: rompería el orden del kNN.
      throw new AiPermanentError('el embedding tiene norma 0');
    }
    return values as number[];
  }

  /**
   * POST con la clave en header, timeout y traducción de fallos a los errores de dominio.
   *
   * El mapeo transitorio/permanente es lo que decide si el runner gasta más cuota: 429 y
   * 5xx vuelven a andar; un 400 significa que la petición está mal armada y reintentarla
   * cinco veces sólo quema el free tier.
   */
  private async post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey, // NUNCA `?key=` en la URL (AC-9)
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // `AbortError` de timeout, DNS, socket: todos reintentables. El mensaje NO
      // incluye el error crudo, que podría traer la URL con credenciales de un proxy.
      const esTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new AiTransientError(
        esTimeout
          ? `el proveedor no respondió en ${timeoutMs} ms`
          : 'no se pudo contactar al proveedor de IA',
      );
    }

    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        throw new AiTransientError(
          `el proveedor respondió ${res.status}`,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        );
      }
      // 4xx que no es 429: petición inválida, clave rechazada, modelo inexistente.
      throw new AiPermanentError(`el proveedor respondió ${res.status}`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new AiPermanentError('la respuesta del proveedor no es JSON válido');
    }
  }
}
