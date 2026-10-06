import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSafeDto {
  @IsString()
  @MinLength(1)
  name: string;

  // Free-form safe type (e.g. "CASH", "BANK", or any custom label) — see
  // the comment on Safe.type in schema.prisma for why this isn't an enum.
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  type: string;

  @IsOptional()
  @IsBoolean()
  isMain?: boolean;
}
