import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { ProductsService } from './products.service';
import { CatalogEventsService } from '../observability/catalog-events.service';
import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';

export interface ProductListResponse {
  data: ProductResponseDto[];
  pagination: { limit: number; offset: number; total: number };
}

@Controller('v1/admin/products')
@UseGuards(AdminGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly events: CatalogEventsService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    const created = await this.products.create(dto);
    this.events.emit('product.created', created.id);
    return ProductResponseDto.from(created);
  }

  @Get()
  async list(
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    const { data, total } = await this.products.list({
      limit: query.limit,
      offset: query.offset,
    });
    return {
      data: data.map(ProductResponseDto.from),
      pagination: { limit: query.limit, offset: query.offset, total },
    };
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProductResponseDto> {
    return ProductResponseDto.from(await this.products.get(id));
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    // AC-4/6/7: si el body trae `status`, es una transición de estado; si no,
    // es una edición de campos (AC-3).
    if (dto.status) {
      const updated = await this.products.changeStatus(id, dto.status);
      if (dto.status === 'published') {
        this.events.emit('product.published', updated.id);
      } else if (dto.status === 'archived') {
        this.events.emit('product.archived', updated.id);
      }
      return ProductResponseDto.from(updated);
    }
    return ProductResponseDto.from(await this.products.update(id, dto));
  }
}
