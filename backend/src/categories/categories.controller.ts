import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresApproval } from '../common/decorators/requires-approval.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  @Permissions('view_reports', 'manage_categories', 'manage_transactions')
  findAll(@Query('kind') kind?: 'IN' | 'OUT') {
    return this.categoriesService.findAll(kind);
  }

  @Get(':id')
  @Permissions('view_reports', 'manage_categories', 'manage_transactions')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Get(':id/summary')
  @Permissions('view_reports', 'manage_categories', 'manage_transactions')
  summary(@Param('id') id: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.categoriesService.summary(id, start, end);
  }

  @Post()
  @Permissions('manage_categories')
  @RequiresApproval()
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Permissions('manage_categories')
  @RequiresApproval()
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('manage_categories')
  @RequiresApproval()
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
