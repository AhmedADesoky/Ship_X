import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class BatchTransactionItemDto {
  @IsIn(['IN', 'OUT'])
  kind: 'IN' | 'OUT';

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  safeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;
}

export class CreateTransactionBatchDto {
  // One optional party shared across every row — طلب سريع's confirmed
  // scope (not picked per-row).
  @IsOptional()
  @IsString()
  partyId?: string;

  // Parallel shared courier, same scope as partyId above.
  @IsOptional()
  @IsString()
  courierId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchTransactionItemDto)
  items: BatchTransactionItemDto[];
}
