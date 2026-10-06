import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { SafesModule } from '../safes/safes.module';

@Module({
  imports: [SafesModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
