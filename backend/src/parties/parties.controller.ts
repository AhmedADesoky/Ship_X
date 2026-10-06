import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresApproval } from '../common/decorators/requires-approval.decorator';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { CreateDrawingDto } from './dto/create-drawing.dto';
import { CreateDeferredDto } from './dto/create-deferred.dto';
import { CreateDeferredPaymentDto } from './dto/create-deferred-payment.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { CancelDrawingDto } from './dto/cancel-drawing.dto';
import { PartiesService } from './parties.service';

@Controller('parties')
export class PartiesController {
  constructor(private partiesService: PartiesService) {}

  @Get()
  @Permissions('view_reports')
  findAll(@Query('partyType') partyType?: string, @Query('q') q?: string) {
    return this.partiesService.findAll(partyType, q);
  }

  // Distinct party types currently in use (across both Parties and
  // Clients), so the "+ add new type" picker on both pages shares the same
  // list — a type added on one page shows up as an option on the other.
  // Must come before `:id` so "types" isn't matched as an id param.
  @Get('types')
  @Permissions('view_reports')
  types() {
    return this.partiesService.listTypes();
  }

  // Batch outstanding-withdrawal totals for the مسحوبات list page — must
  // come before ":id" so "drawings" isn't matched as a party id.
  @Get('drawings/outstanding-summary')
  @Permissions('view_reports')
  outstandingSummary(@Query('partyType') partyType?: string) {
    return this.partiesService.getOutstandingSummary(partyType);
  }

  // Batch outstanding-deferred (آجل) totals for the آجل list page — must
  // come before ":id" for the same reason as "drawings/outstanding-summary".
  @Get('deferred/outstanding-summary')
  @Permissions('view_reports')
  deferredOutstandingSummary(@Query('partyType') partyType?: string) {
    return this.partiesService.getOutstandingDeferredSummary(partyType);
  }

  @Get(':id')
  @Permissions('view_reports')
  findOne(@Param('id') id: string) {
    return this.partiesService.findOne(id);
  }

  @Get(':id/summary')
  @Permissions('view_reports')
  summary(@Param('id') id: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.partiesService.summary(id, start, end);
  }

  @Get(':id/statement')
  @Permissions('view_reports')
  statement(@Param('id') id: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.partiesService.statement(id, start, end);
  }

  @Post()
  @Permissions('manage_parties')
  @RequiresApproval()
  create(@Body() dto: CreatePartyDto) {
    return this.partiesService.create(dto);
  }

  @Patch(':id')
  @Permissions('manage_parties')
  @RequiresApproval()
  update(@Param('id') id: string, @Body() dto: UpdatePartyDto) {
    return this.partiesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('manage_parties')
  @RequiresApproval()
  remove(@Param('id') id: string) {
    return this.partiesService.remove(id);
  }

  // مسحوبات
  @Get(':id/drawings')
  @Permissions('view_reports')
  listDrawings(@Param('id') id: string) {
    return this.partiesService.listDrawings(id);
  }

  @Post(':id/drawings')
  @Permissions('manage_parties')
  createDrawing(@Param('id') id: string, @Body() dto: CreateDrawingDto, @CurrentUser() user: AuthUser) {
    return this.partiesService.createDrawing(id, dto, user?.userId);
  }

  // آجل
  @Get(':id/deferred')
  @Permissions('view_reports')
  listDeferred(@Param('id') id: string) {
    return this.partiesService.listDeferred(id);
  }

  @Post(':id/deferred')
  @Permissions('manage_parties')
  createDeferred(@Param('id') id: string, @Body() dto: CreateDeferredDto) {
    return this.partiesService.createDeferred(id, dto);
  }

  @Post(':id/deferred/:deferredId/payments')
  @Permissions('manage_parties')
  createDeferredPayment(
    @Param('id') id: string,
    @Param('deferredId') deferredId: string,
    @Body() dto: CreateDeferredPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.partiesService.createDeferredPayment(id, deferredId, dto, user?.userId);
  }

  // تسوية الراسل (sender settlement)
  @Get(':id/settlements')
  @Permissions('view_reports')
  listSettlements(@Param('id') id: string) {
    return this.partiesService.listSettlements(id);
  }

  @Post(':id/settlements')
  @Permissions('manage_parties')
  @RequiresApproval()
  createSettlement(@Param('id') id: string, @Body() dto: CreateSettlementDto, @CurrentUser() user: AuthUser) {
    return this.partiesService.createSettlement(id, dto, user?.userId);
  }

  @Get(':id/drawings/:drawingId/applications')
  @Permissions('view_reports')
  getDrawingApplicationHistory(@Param('drawingId') drawingId: string) {
    return this.partiesService.getDrawingApplicationHistory(drawingId);
  }

  @Post(':id/drawings/:drawingId/cancel')
  @Permissions('manage_parties')
  cancelDrawing(
    @Param('id') id: string,
    @Param('drawingId') drawingId: string,
    @Body() dto: CancelDrawingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.partiesService.cancelDrawing(id, drawingId, dto, user?.userId);
  }
}
