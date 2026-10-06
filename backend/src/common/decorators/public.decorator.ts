import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring JWT auth (e.g. /auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
