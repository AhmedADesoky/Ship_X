import { Controller, Get, Query } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('dashboard')
  @Permissions('view_dashboard')
  getDashboard() {
    return this.reportsService.getDashboard();
  }

  @Get()
  @Permissions('view_reports')
  getReports(@Query('start') start?: string, @Query('end') end?: string) {
    return this.reportsService.getReports(start, end);
  }
}
