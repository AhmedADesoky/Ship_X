import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { ALL_PERMISSIONS } from '../../common/role-permissions';
import { IsNotCommonPassword } from '../../common/validators/not-common-password.validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  name: string;

  // Free-form display label (e.g. "Senior Accountant") — cosmetic only,
  // does not affect access control. See User.title in schema.prisma.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsEnum(Role)
  role: Role;

  // Extra permissions granted to this specific user on top of their role's
  // defaults (never a restriction below the role default). See
  // RolePermission in schema.prisma and role-permissions.ts.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  extraPermissions?: string[];

  // TODO(supabase-auth): interim bcrypt-hashed password so login actually
  // verifies something before Supabase Auth is wired up. Once that lands,
  // account creation/password-setting moves to Supabase's admin API and
  // this field goes away.
  @IsString()
  @MinLength(8)
  @IsNotCommonPassword()
  password: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
