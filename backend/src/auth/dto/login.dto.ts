import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Only required on the second call of the login flow, when the first
  // call's response reported mfaRequired: true.
  @IsOptional()
  @IsString()
  mfaCode?: string;
}
