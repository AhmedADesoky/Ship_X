import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePartyDto {
  @IsString()
  @MinLength(1)
  name: string;

  // Free-form party type (e.g. "AGENT", "MERCHANT", or any custom label) —
  // see the comment on Party.partyType in schema.prisma for why this isn't
  // a fixed enum.
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  partyType: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
