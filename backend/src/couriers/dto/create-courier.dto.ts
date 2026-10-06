import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCourierDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
