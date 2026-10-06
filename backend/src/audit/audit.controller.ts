import { Controller, Get, Query } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuditService } from './audit.service';

@Controller('audit')
@Permissions('view_audit_log')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditService.findAll(page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined, {
      actorId,
      entityType,
      from,
      to,
    });
  }
}
