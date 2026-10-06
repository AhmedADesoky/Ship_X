import { Module } from '@nestjs/common';
import { PendingActionsController } from './pending-actions.controller';
import { PendingActionsService } from './pending-actions.service';
import { PartiesModule } from '../parties/parties.module';
import { CategoriesModule } from '../categories/categories.module';
import { SafesModule } from '../safes/safes.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CouriersModule } from '../couriers/couriers.module';

@Module({
  imports: [PartiesModule, CategoriesModule, SafesModule, TransactionsModule, CouriersModule],
  controllers: [PendingActionsController],
  providers: [PendingActionsService],
})
export class PendingActionsModule {}
