import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CategoriesService } from './categories.service';
import {
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@Controller('v1/admin/categories')
@UseGuards(AdminGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const created = await this.categories.create(dto);
    return CategoryResponseDto.from(created);
  }

  @Get()
  async list(): Promise<CategoryResponseDto[]> {
    const all = await this.categories.list();
    return all.map(CategoryResponseDto.from);
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const updated = await this.categories.update(id, dto);
    return CategoryResponseDto.from(updated);
  }
}
