import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Self-service profile edit — deliberately narrower than UpdateUserDto
// (no role/permissions/active — those stay admin-only via PATCH /users/:id).
export class UpdateSelfDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}
