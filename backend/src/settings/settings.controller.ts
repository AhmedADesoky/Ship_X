import { Body, Controller, Get, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  @Permissions('view_reports')
  getAll() {
    return this.settingsService.getAll();
  }

  @Get('export')
  @Permissions('manage_settings')
  async export(@Res() res: Response) {
    const data = await this.settingsService.exportData();
    const filename = `shipx-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Put()
  @Permissions('manage_settings')
  update(@Body() payload: Record<string, string>) {
    return this.settingsService.update(payload);
  }

  @Post('reset')
  @Permissions('reset_system')
  reset(@Body('confirm') confirm: string) {
    return this.settingsService.resetSystem(confirm);
  }

  @Post('clear-numbers')
  @Permissions('reset_system')
  clearNumbers(@Body('confirm') confirm: string) {
    return this.settingsService.clearNumbers(confirm);
  }
}
