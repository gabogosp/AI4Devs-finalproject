import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Product } from '@dsm/db';
import { PRODUCT_STATUSES, ProductStatus } from '../products.state';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description_raw?: string;

  @IsInt()
  @Min(1)
  price_ars_cents!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsUUID()
  category_id!: string;

  @IsOptional()
  @IsString()
  image_url?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description_raw?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  price_ars_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  // Transición de estado (AC-4/6/7). Si viene, el controller enruta a changeStatus.
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

export class ListProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class ProductResponseDto {
  id!: string;
  sku!: string;
  name!: string;
  description_raw!: string | null;
  price_ars_cents!: number;
  stock!: number;
  status!: string;
  category_id!: string;
  image_url!: string | null;
  created_at!: string;
  updated_at!: string;

  static from(p: Product): ProductResponseDto {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description_raw: p.description_raw,
      price_ars_cents: p.price_ars_cents,
      stock: p.stock,
      status: p.status,
      category_id: p.category_id,
      image_url: p.image_url,
      created_at: p.created_at.toISOString(),
      updated_at: p.updated_at.toISOString(),
    };
  }
}
