import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateDrawingDto {
  @IsString()
  safeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
