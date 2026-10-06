import { IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReconciliationDto {
  @IsString()
  @IsNotEmpty()
  safeId: string;

  @IsISO8601()
  reconDate: string;

  @IsNumber()
  actualBalance: number;

  @IsOptional()
  @IsString()
  note?: string;
}
