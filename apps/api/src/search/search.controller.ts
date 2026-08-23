import {
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  StorefrontCache,
  StorefrontCacheInterceptor,
} from '../storefront/storefront-cache.interceptor';
import { SearchQueryDto, SearchResponseDto } from './dto/search.dto';
import { SearchService } from './search.service';
import { SearchThrottlerGuard } from './search-throttler.guard';

/**
 * Presupuesto del endpoint, leído de `process.env` al cargar la clase (los decoradores se
 * evalúan antes del contenedor). Zod ya validó el valor al arrancar.
 */
const RATE_LIMIT_MAX = Number(process.env.SEARCH_RATE_LIMIT_MAX ?? 20);
const RATE_LIMIT_TTL_MS = Number(process.env.SEARCH_RATE_LIMIT_TTL_MS ?? 60_000);

/**
 * Superficie **pública** de la búsqueda semántica (US-004) — el diferenciador del producto.
 *
 * El controller es deliberadamente fino: ninguna regla de relevancia, de umbral ni de
 * degradación vive acá. Eso está en `SearchService` y en `relevance.ts`, que se ejercen sin
 * HTTP; el controller sólo traduce query params a una llamada y el resultado a un DTO.
 *
 * **Caché acotada, no `no-store`.** La respuesta es contenido público derivado del catálogo, no
 * algo personalizado: dos clientes que buscan lo mismo merecen la misma respuesta, y 60
 * segundos de frescura son aceptables para un precio (es la política que US-003 ya fijó para la
 * ficha). Con `no-store` cada tecleo llegaría al origen y —peor— a la cuota del proveedor.
 */
@Controller('v1/search')
@UseGuards(SearchThrottlerGuard)
// Los presupuestos ajenos se saltean explícitamente: buscar no puede consumir el cupo de
// navegar el catálogo, ni el del carrito, ni el de login.
@SkipThrottle({ auth: true, storefront: true, cart: true, enrichment: true })
@UseInterceptors(StorefrontCacheInterceptor)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * `GET` y no `POST` (el `readme` de la Entrega 1 mostraba `POST /search`).
   *
   * La razón es que una búsqueda es una **lectura**: con `GET` la consulta es enlazable y
   * compartible, el cliente puede cachearla y el edge también. Un `POST` habría cerrado las
   * tres cosas para ganar sólo la comodidad de un cuerpo JSON. Queda declarado como desviación
   * del contrato ilustrativo de la Entrega 1.
   */
  @Get()
  // 20 por minuto por IP: más estricto que el storefront porque acá cada request puede costar
  // plata en un tercero, no sólo CPU (§7.3, AC-10).
  @Throttle({ search: { limit: RATE_LIMIT_MAX, ttl: RATE_LIMIT_TTL_MS } })
  // 60 s de frescura + 30 s de `stale-while-revalidate`, igual que la ficha pública.
  @StorefrontCache({ maxAge: 60, swr: 30 })
  async buscar(
    @Query() query: SearchQueryDto,
    @Headers('traceparent') traceparent?: string,
  ): Promise<SearchResponseDto> {
    const outcome = await this.search.search(query.q, query.limit, traceparent);
    return SearchResponseDto.from(outcome);
  }
}
