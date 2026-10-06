import { Module } from '@nestjs/common';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { SafesModule } from '../safes/safes.module';

@Module({
  imports: [SafesModule],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
