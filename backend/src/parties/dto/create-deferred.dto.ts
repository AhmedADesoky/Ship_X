import { IsNumber, IsPositive } from 'class-validator';

export class CreateDeferredDto {
  @IsNumber()
  @IsPositive()
  originalAmount: number;
}
