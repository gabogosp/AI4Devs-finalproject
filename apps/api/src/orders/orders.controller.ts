import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { OrdersAdminService } from './orders-admin.service';
import { OrderStatusHistoryRepository } from './order-status-history.repository';
import {
  AdminOrderDetailDto,
  AdminOrderSummaryDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';

export interface AdminOrdersListResponse {
  data: AdminOrderSummaryDto[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * `:id` restringido a forma UUID (design.md §D6) — evita que
 * `GET /v1/admin/orders/pending-payment` (`PaymentConfirmationController`,
 * US-023, mismo `@Controller` prefix) matchee acá como si `"pending-payment"`
 * fuera un id, sin importar el orden de registro de los dos módulos en
 * `app.module.ts`.
 */
const UUID_PATH =
  ':id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

@Controller('v1/admin/orders')
@UseGuards(AdminGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersAdminService,
    private readonly history: OrderStatusHistoryRepository,
    private readonly jwt: JwtService,
  ) {}

  @Get()
  async list(@Query() query: ListOrdersQueryDto): Promise<AdminOrdersListResponse> {
    const { data, pagination } = await this.orders.list(query);
    return { data: data.map(AdminOrderSummaryDto.from), pagination };
  }

  @Get(UUID_PATH)
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminOrderDetailDto> {
    const order = await this.orders.get(id);
    const history = await this.history.listByOrderId(id);
    return AdminOrderDetailDto.fromWithHistory(order, history);
  }

  @Patch(UUID_PATH)
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: Request,
  ): Promise<AdminOrderDetailDto> {
    const changedBy = this.changedByFrom(req);
    await this.orders.changeStatus(id, dto.status, changedBy);
    const order = await this.orders.get(id);
    const history = await this.history.listByOrderId(id);
    return AdminOrderDetailDto.fromWithHistory(order, history);
  }

  /**
   * Decodifica (NO re-verifica — `AdminGuard` ya lo hizo) el mismo bearer
   * token para leer `sub`. `AdminGuard` está congelado (US-014 lo declara con
   * un `git diff --exit-code`) y no adjunta el payload a `req` — mismo
   * patrón que `PaymentConfirmationController` de US-023 estableció para no
   * tocarlo.
   */
  private changedByFrom(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = this.jwt.decode(token) as { sub?: string } | null;
    return payload?.sub ?? null;
  }
}
