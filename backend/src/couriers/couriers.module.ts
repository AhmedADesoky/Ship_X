import { Module } from '@nestjs/common';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';
import { SafesModule } from '../safes/safes.module';

@Module({
  imports: [SafesModule],
  controllers: [CouriersController],
  providers: [CouriersService],
  exports: [CouriersService],
})
export class CouriersModule {}
