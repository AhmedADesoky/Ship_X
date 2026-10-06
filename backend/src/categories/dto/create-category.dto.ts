import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['IN', 'OUT'])
  kind: 'IN' | 'OUT';

  // Which party type transactions under this category require a party
  // picker for — independent of the (user-editable) name. null clears it.
  @IsOptional()
  @IsIn(['AGENT', 'MERCHANT', null])
  partyType?: 'AGENT' | 'MERCHANT' | null;

  // Parallel to partyType, but for مناديب القاهرة والجيزة (Courier) instead
  // of Party — mutually exclusive with partyType, enforced in
  // CategoriesService.
  @IsOptional()
  @IsBoolean()
  requiresCourier?: boolean;
}
