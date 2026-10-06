import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsNotCommonPassword } from '../../common/validators/not-common-password.validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  @IsNotCommonPassword()
  newPassword: string;
}
