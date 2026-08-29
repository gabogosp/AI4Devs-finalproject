import { IsOptional, IsString, IsNotEmpty, IsUUID } from 'class-validator';
import { Category } from '@dsm/db';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}

export class UpdateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}

export class CategoryResponseDto {
  id!: string;
  slug!: string;
  name!: string;
  parent_id!: string | null;
  created_at!: string;

  static from(c: Category): CategoryResponseDto {
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      parent_id: c.parent_id,
      created_at: c.created_at.toISOString(),
    };
  }
}
