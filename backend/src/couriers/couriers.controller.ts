import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresApproval } from '../common/decorators/requires-approval.decorator';
import { CreateCourierDto } from './dto/create-courier.dto';
import { UpdateCourierDto } from './dto/update-courier.dto';
import { CreateSheetCollectionDto } from './dto/create-sheet-collection.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { CreateRepaymentDto } from './dto/create-repayment.dto';
import { AssignSheetCollectionDto } from './dto/assign-sheet-collection.dto';
import { CouriersService } from './couriers.service';

@Controller('couriers')
export class CouriersController {
  constructor(private couriersService: CouriersService) {}

  @Get()
  @Permissions('view_reports')
  findAll(@Query('q') q?: string, @Query('status') status?: string) {
    return this.couriersService.findAll(q, status);
  }

  // Batch outstanding-summary for the list page — must come before ":id"
  // so "summary" isn't matched as a courier id.
  @Get('summary')
  @Permissions('view_reports')
  outstandingSummary() {
    return this.couriersService.getOutstandingSummary();
  }

  // تحصيل شيت — courierId is optional in the body (historical/unassigned
  // collections); a single endpoint used both from a courier's own page
  // and the standalone/historical entry point, avoiding two code paths
  // for the same action. Must come before ":id" for the same reason as
  // "summary" above.
  @Post('sheet-collections')
  @Permissions('manage_couriers')
  @RequiresApproval()
  createSheetCollection(@Body() dto: CreateSheetCollectionDto, @CurrentUser() user: AuthUser) {
    return this.couriersService.createSheetCollection(dto, user?.userId);
  }

  // تقفيلات الشيتات غير المرتبطة بمندوب (Phase 35) — must come before ":id"
  // for the same reason as "summary"/"sheet-collections" above.
  @Get('sheet-collections/unassigned')
  @Permissions('view_reports')
  listUnassignedSheetCollections() {
    return this.couriersService.listUnassignedSheetCollections();
  }

  @Patch('sheet-collections/:collectionId/assign')
  @Permissions('manage_couriers')
  @RequiresApproval()
  assignSheetCollection(@Param('collectionId') collectionId: string, @Body() dto: AssignSheetCollectionDto) {
    return this.couriersService.assignSheetCollection(dto.collectionId || collectionId, dto.courierId);
  }

  @Get(':id')
  @Permissions('view_reports')
  findOne(@Param('id') id: string) {
    return this.couriersService.findOne(id);
  }

  @Post()
  @Permissions('manage_couriers')
  @RequiresApproval()
  create(@Body() dto: CreateCourierDto) {
    return this.couriersService.create(dto);
  }

  @Patch(':id')
  @Permissions('manage_couriers')
  @RequiresApproval()
  update(@Param('id') id: string, @Body() dto: UpdateCourierDto) {
    return this.couriersService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('manage_couriers')
  @RequiresApproval()
  remove(@Param('id') id: string) {
    return this.couriersService.remove(id);
  }

  @Get(':id/summary')
  @Permissions('view_reports')
  summary(@Param('id') id: string) {
    return this.couriersService.summary(id);
  }

  @Get(':id/statement')
  @Permissions('view_reports')
  statement(@Param('id') id: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.couriersService.statement(id, start, end);
  }

  @Get(':id/sheet-collections')
  @Permissions('view_reports')
  listSheetCollections(@Param('id') id: string) {
    return this.couriersService.listSheetCollections(id);
  }

  @Get(':id/advances')
  @Permissions('view_reports')
  listAdvances(@Param('id') id: string) {
    return this.couriersService.listAdvances(id);
  }

  @Post(':id/advances')
  @Permissions('manage_couriers')
  @RequiresApproval()
  createAdvance(@Param('id') id: string, @Body() dto: CreateAdvanceDto, @CurrentUser() user: AuthUser) {
    return this.couriersService.createAdvance(id, dto, user?.userId);
  }

  @Post(':id/advances/:advanceId/repayments')
  @Permissions('manage_couriers')
  @RequiresApproval()
  createRepayment(
    @Param('id') id: string,
    @Param('advanceId') advanceId: string,
    @Body() dto: CreateRepaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.couriersService.createRepayment(id, advanceId, dto, user?.userId);
  }
}
