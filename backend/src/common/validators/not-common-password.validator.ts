import { registerDecorator, ValidationOptions } from 'class-validator';

// A short embedded blocklist of the most common breached/guessable
// passwords — NIST 800-63B recommends screening against known-breached
// passwords over composition rules (forced symbols/uppercase etc, which
// this app deliberately does NOT require). Not exhaustive; catches the
// obvious/lazy cases without needing an external breach-database service.
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'qwertyuiop',
    'letmein123',
    'welcome123',
    'admin1234',
    'admin123',
    'iloveyou1',
    'sunshine1',
    'princess1',
    'football1',
    'baseball1',
    'monkey123',
    'dragon123',
    'trustno1',
    'abc123456',
    'passw0rd',
    'p@ssw0rd',
    'p@ssword',
    'changeme',
    'changeme123',
    '11111111',
    '00000000',
    'letmein1',
  ].map((p) => p.toLowerCase()),
);

export function IsNotCommonPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotCommonPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && !COMMON_PASSWORDS.has(value.toLowerCase());
        },
        defaultMessage() {
          return 'This password is too common — choose something less guessable';
        },
      },
    });
  };
}
