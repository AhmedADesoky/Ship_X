import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresApproval } from '../common/decorators/requires-approval.decorator';
import { CreateSafeDto } from './dto/create-safe.dto';
import { TransferDto } from './dto/transfer.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { DepositDto } from './dto/deposit.dto';
import { SafesService } from './safes.service';

@Controller('safes')
export class SafesController {
  constructor(private safesService: SafesService) {}

  // Reused by the safe picker in nearly every money-moving dialog across
  // the app (Income/Expense, Settlement, Couriers, Drawings/Deferred,
  // Reconciliation, Import), not just the dedicated Safes page — the OR
  // list below covers every manage_* permission whose dialogs read this
  // endpoint, mirroring each route's own frontend OR-list in
  // frontend/lib/permissions.ts rather than a single-permission compromise.
  @Get()
  @Permissions(
    'view_reports',
    'view_safes',
    'manage_safes',
    'manage_transactions',
    'manage_parties',
    'manage_couriers',
    'manage_reconciliations',
    'manage_import',
  )
  findAll() {
    return this.safesService.getBalances();
  }

  @Get(':id')
  @Permissions(
    'view_reports',
    'view_safes',
    'manage_safes',
    'manage_transactions',
    'manage_parties',
    'manage_couriers',
    'manage_reconciliations',
    'manage_import',
  )
  async findOne(@Param('id') id: string) {
    const safe = await this.safesService.findOne(id);
    const balance = await this.safesService.getBalance(id);
    return { ...safe, balance };
  }

  @Post()
  @Permissions('manage_safes')
  @RequiresApproval()
  create(@Body() dto: CreateSafeDto) {
    return this.safesService.create(dto);
  }

  @Post('transfer')
  @Permissions('manage_safes')
  transfer(@Body() dto: TransferDto, @CurrentUser() user: AuthUser) {
    return this.safesService.transfer(dto, user?.userId);
  }

  @Post(':id/adjust-balance')
  @Permissions('manage_safes')
  @RequiresApproval()
  adjustBalance(@Param('id') id: string, @Body() dto: AdjustBalanceDto, @CurrentUser() user: AuthUser) {
    return this.safesService.adjustBalance(id, dto, user?.userId);
  }

  @Post(':id/deposit')
  @Permissions('manage_safes')
  deposit(@Param('id') id: string, @Body() dto: DepositDto, @CurrentUser() user: AuthUser) {
    return this.safesService.deposit(id, dto, user?.userId);
  }

  // Deliberately a stricter permission than the other safe-management
  // routes above (`manage_safes`) — deletion is OWNER-only by default;
  // anyone else needs an explicit per-user grant of `delete_safes`.
  @Delete(':id')
  @Permissions('delete_safes')
  @RequiresApproval()
  remove(@Param('id') id: string) {
    return this.safesService.remove(id);
  }
}
