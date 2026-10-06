import { IsOptional, IsString } from 'class-validator';

export class CancelDrawingDto {
  @IsOptional()
  @IsString()
  note?: string;
}
