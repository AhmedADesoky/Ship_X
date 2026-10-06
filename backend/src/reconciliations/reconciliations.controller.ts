import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { ReconciliationsService } from './reconciliations.service';

@Controller('reconciliations')
export class ReconciliationsController {
  constructor(private reconciliationsService: ReconciliationsService) {}

  @Get()
  @Permissions('view_reports')
  findAll() {
    return this.reconciliationsService.findAll();
  }

  @Post()
  @Permissions('manage_reconciliations')
  create(@Body() dto: CreateReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.reconciliationsService.create(dto, user?.userId);
  }
}
