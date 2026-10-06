import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseStorageService } from '../common/supabase-storage.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, SupabaseStorageService],
  exports: [UsersService],
})
export class UsersModule {}
