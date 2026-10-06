import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSelfDto } from './dto/update-self.dto';
import { UsersService } from './users.service';

@Controller('users')
@Permissions('manage_users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.usersService.findAll(Number(page) || undefined, Number(pageSize) || undefined, includeInactive === 'true');
  }

  // Self-service routes: any authenticated user may edit/inspect their own
  // account, not just holders of manage_users. Overrides the class-level
  // @Permissions('manage_users') with an empty requirement (RolesGuard's
  // getAllAndOverride prefers method-level metadata).
  @Permissions()
  @Patch('me')
  updateSelf(@CurrentUser() user: AuthUser, @Body() dto: UpdateSelfDto) {
    return this.usersService.updateSelf(user.userId, dto);
  }

  @Permissions()
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadAvatar(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadAvatar(user.userId, file);
  }

  @Permissions()
  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.usersService.removeAvatar(user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  // Deliberately a stricter permission than the class-level manage_users —
  // deactivating another user is OWNER-only by default, matching how
  // delete_safes gates safe deletion (safes.controller.ts).
  @Delete(':id')
  @Permissions('delete_users')
  remove(@CurrentUser() caller: AuthUser, @Param('id') id: string) {
    return this.usersService.remove(id, caller.userId);
  }
}
