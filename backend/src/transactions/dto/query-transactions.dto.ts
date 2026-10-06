import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class QueryTransactionsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['IN', 'OUT'])
  kind?: 'IN' | 'OUT';

  @IsOptional()
  @IsString()
  safeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  partyId?: string;

  @IsOptional()
  @IsISO8601()
  start?: string;

  @IsOptional()
  @IsISO8601()
  end?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
