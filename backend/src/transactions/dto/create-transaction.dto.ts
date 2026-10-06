import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['IN', 'OUT'])
  kind: 'IN' | 'OUT';

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @IsNotEmpty()
  safeId: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  // Parallel, independent linkage to partyId — set only for a category
  // with Category.requiresCourier=true.
  @IsOptional()
  @IsString()
  courierId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsISO8601()
  date?: string;
}
