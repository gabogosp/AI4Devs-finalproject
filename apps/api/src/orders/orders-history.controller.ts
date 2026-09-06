import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CustomerGuard, RequestConCliente } from '../auth/customer.guard';
import { OrdersHistoryThrottlerGuard } from './orders-history-throttler.guard';
import { OrdersHistoryService } from './orders-history.service';
import {
  ListOrderHistoryQueryDto,
  OrderHistoryDetailDto,
  OrderHistorySummaryDto,
} from './dto/order-history.dto';

export interface OrderHistoryListResponse {
  data: OrderHistorySummaryDto[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * Presupuesto de lectura del historial, leído de `process.env` (los
 * decoradores se evalúan antes del contenedor). Zod ya validó el valor al
 * arrancar (T4.2).
 */
const ORDERS_HISTORY_RATE_LIMIT_MAX = Number(
  process.env.ORDERS_HISTORY_RATE_LIMIT_MAX ?? 60,
);

/**
 * Historial de compras del cliente autenticado (US-015, design.md §D5) —
 * superficie de CLIENTE, distinta de `OrdersController` (admin, US-012)
 * aunque leen las mismas tablas. `CustomerGuard` (fail-closed) gatea los dos
 * endpoints: sin sesión válida, 401 antes de ejecutar el handler (AC-5).
 *
 * `:order_number(\\d+)` restringido a dígitos — mismo criterio que el
 * `UUID_PATH` de `OrdersController`, evita que una ruta futura bajo
 * `v1/me/orders/` colisione.
 */
@Controller('v1/me/orders')
@UseGuards(OrdersHistoryThrottlerGuard, CustomerGuard)
// Los presupuestos ajenos se saltean explícitamente — agotar el historial no
// puede consumir el cupo de auth, storefront, carrito, enrichment, search,
// checkout ni el medio simulado de pagos.
@SkipThrottle({
  auth: true,
  storefront: true,
  cart: true,
  enrichment: true,
  search: true,
  checkout: true,
  payments_simulate: true,
})
export class OrdersHistoryController {
  constructor(private readonly history: OrdersHistoryService) {}

  @Get()
  @Throttle({ orders_history: { limit: ORDERS_HISTORY_RATE_LIMIT_MAX } })
  async list(
    @Query() query: ListOrderHistoryQueryDto,
    @Req() req: RequestConCliente,
  ): Promise<OrderHistoryListResponse> {
    const { data, pagination } = await this.history.list(req.customerId as string, {
      limit: query.limit,
      offset: query.offset,
    });
    return { data: data.map(OrderHistorySummaryDto.from), pagination };
  }

  @Get(':order_number(\\d+)')
  @Throttle({ orders_history: { limit: ORDERS_HISTORY_RATE_LIMIT_MAX } })
  async detail(
    @Param('order_number', ParseIntPipe) orderNumber: number,
    @Req() req: RequestConCliente,
  ): Promise<OrderHistoryDetailDto> {
    const order = await this.history.detail(req.customerId as string, orderNumber);
    return OrderHistoryDetailDto.fromDetail(order);
  }
}
