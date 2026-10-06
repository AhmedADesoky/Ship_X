import { IsNumber, IsPositive, IsString } from 'class-validator';

export class CreateDeferredPaymentDto {
  @IsString()
  safeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;
}
