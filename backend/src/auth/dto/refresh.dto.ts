import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  // Optional now that the refresh token normally travels via the httpOnly
  // cookie set on login — only present for callers without cookie support.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
