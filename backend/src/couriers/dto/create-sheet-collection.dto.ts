import { IsISO8601, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateSheetCollectionDto {
  // Nullable/omittable on purpose — historical/opening collections (money
  // collected before this system existed) have no specific courier.
  @IsOptional()
  @IsString()
  courierId?: string | null;

  @IsString()
  safeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsISO8601()
  date?: string;

  // Purely descriptive audit metadata ("COURIER_PAGE" | "INCOME_PAGE") —
  // never read by any total/validation logic. Defaults server-side when
  // omitted (covers direct API callers that don't send it).
  @IsOptional()
  @IsString()
  source?: string;
}
