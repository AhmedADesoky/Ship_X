import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ImportService } from './import.service';

@Controller('import')
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('inspect')
  @Permissions('manage_import')
  @UseInterceptors(FileInterceptor('file'))
  inspect(@UploadedFile() file: Express.Multer.File) {
    return this.importService.inspect(file);
  }

  @Post('commit')
  @Permissions('manage_import')
  @UseInterceptors(FileInterceptor('file'))
  commit(
    @UploadedFile() file: Express.Multer.File,
    @Body('defaultSafeId') defaultSafeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.importService.commit(file, defaultSafeId, user?.userId);
  }

  @Get('history')
  @Permissions('view_reports')
  history() {
    return this.importService.history();
  }
}
