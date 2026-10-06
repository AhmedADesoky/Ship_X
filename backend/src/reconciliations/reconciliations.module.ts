import { Module } from '@nestjs/common';
import { SafesModule } from '../safes/safes.module';
import { ReconciliationsController } from './reconciliations.controller';
import { ReconciliationsService } from './reconciliations.service';

@Module({
  imports: [SafesModule],
  controllers: [ReconciliationsController],
  providers: [ReconciliationsService],
})
export class ReconciliationsModule {}
