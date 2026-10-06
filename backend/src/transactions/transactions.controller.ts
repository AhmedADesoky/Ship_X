import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresApproval } from '../common/decorators/requires-approval.decorator';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { CreateTransactionBatchDto } from './dto/create-transaction-batch.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Get()
  @Permissions('view_reports', 'edit_transactions', 'manage_transactions')
  findAll(@Query() query: QueryTransactionsDto) {
    return this.transactionsService.findAll(query);
  }

  @Get(':id')
  @Permissions('view_reports', 'edit_transactions', 'manage_transactions')
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }

  @Post()
  @Permissions('manage_transactions')
  @RequiresApproval()
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: AuthUser) {
    return this.transactionsService.create(dto, user?.userId);
  }

  // طلب سريع (quick request) — several IN/OUT rows in one atomic batch.
  // Gated the same as a single create() so an Employee's batch is queued
  // for approval exactly like an individual transaction would be.
  @Post('batch')
  @Permissions('manage_transactions')
  @RequiresApproval()
  createBatch(@Body() dto: CreateTransactionBatchDto, @CurrentUser() user: AuthUser) {
    return this.transactionsService.createBatch(dto, user?.userId);
  }

  @Patch(':id')
  @Permissions('manage_transactions')
  @RequiresApproval()
  update(@Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactionsService.update(id, dto);
  }

  @Post(':id/void')
  @Permissions('manage_transactions')
  @RequiresApproval()
  void(@Param('id') id: string) {
    return this.transactionsService.void(id);
  }
}
