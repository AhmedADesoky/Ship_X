import { Module } from '@nestjs/common';
import { SafesController } from './safes.controller';
import { SafesService } from './safes.service';

@Module({
  controllers: [SafesController],
  providers: [SafesService],
  exports: [SafesService],
})
export class SafesModule {}
