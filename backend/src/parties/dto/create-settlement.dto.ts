import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum SettlementApplicationMode {
  ALL = 'ALL',
  CUSTOM_TOTAL = 'CUSTOM_TOTAL',
  SPECIFIC = 'SPECIFIC',
  NONE = 'NONE',
}

export class SettlementApplicationItemDto {
  @IsUUID()
  drawingId: string;

  @IsNumber()
  @IsPositive()
  amount: number;
}

export class CreateSettlementDto {
  @IsString()
  safeId: string;

  @IsNumber()
  @IsPositive()
  grossAmount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsEnum(SettlementApplicationMode)
  applicationMode: SettlementApplicationMode;

  @ValidateIf((o) => o.applicationMode === SettlementApplicationMode.CUSTOM_TOTAL)
  @IsNumber()
  @IsPositive()
  customTotal?: number;

  @ValidateIf((o) => o.applicationMode === SettlementApplicationMode.SPECIFIC)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementApplicationItemDto)
  specificApplications?: SettlementApplicationItemDto[];

  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}
