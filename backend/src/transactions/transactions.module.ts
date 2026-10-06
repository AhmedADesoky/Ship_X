import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PartiesModule } from '../parties/parties.module';
import { SafesModule } from '../safes/safes.module';

@Module({
  imports: [PartiesModule, SafesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
