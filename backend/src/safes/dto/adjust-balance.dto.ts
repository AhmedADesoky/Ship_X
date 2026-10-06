import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustBalanceDto {
  @IsNumber()
  targetBalance: number;

  @IsOptional()
  @IsString()
  note?: string;
}
