import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  fromSafeId: string;

  @IsString()
  @IsNotEmpty()
  toSafeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}
