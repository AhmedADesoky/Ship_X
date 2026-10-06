import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PendingActionsService } from './pending-actions.service';

@Controller('pending-actions')
export class PendingActionsController {
  constructor(private pendingActionsService: PendingActionsService) {}

  @Get()
  @Permissions('manage_pending_actions')
  findAll(@Query('status') status?: string) {
    return this.pendingActionsService.list(status);
  }

  @Post(':id/approve')
  @Permissions('manage_pending_actions')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.pendingActionsService.approve(id, user!.userId);
  }

  @Post(':id/reject')
  @Permissions('manage_pending_actions')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.pendingActionsService.reject(id, user!.userId);
  }
}
