import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class DepositDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
