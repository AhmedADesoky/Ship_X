import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from './supabase-storage.service';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

// file-type v22+ is ESM-only; Jest's CommonJS runtime can't actually load it
// via dynamic import() the way Node's real runtime can, so it's mocked here
// with just enough real signature-sniffing to exercise the same PNG/non-PNG
// branches the production code depends on.
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: async (buffer: Buffer) => {
      if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
      }
      return undefined;
    },
  }),
  { virtual: true },
);

describe('SupabaseStorageService - uploadAvatar() content-type validation', () => {
  let service: SupabaseStorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupabaseStorageService, { provide: ConfigService, useValue: { get: () => undefined } }],
    }).compile();
    service = module.get(SupabaseStorageService);
  });

  it('rejects a buffer with no recognizable image signature (e.g. an SVG/text payload), regardless of the client-supplied mimetype', async () => {
    const maliciousSvg = Buffer.from('<svg onload="alert(1)"></svg>');
    await expect(
      service.uploadAvatar('user-1', {
        buffer: maliciousSvg,
        mimetype: 'image/png', // lies about its own type — must not be trusted
        originalname: 'avatar.png',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty/undetectable buffer', async () => {
    await expect(
      service.uploadAvatar('user-1', { buffer: Buffer.from(''), mimetype: 'image/png', originalname: 'avatar.png' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  // A real PNG buffer passes the content check and proceeds to the Supabase
  // client call, which throws here since no SUPABASE_URL/KEY is configured
  // in this test — that failure (not a BadRequestException) is itself the
  // proof the content-type gate was passed.
  it('accepts a real PNG signature and proceeds past the content-type gate', async () => {
    await expect(
      service.uploadAvatar('user-1', { buffer: PNG_HEADER, mimetype: 'image/png', originalname: 'avatar.png' } as any),
    ).rejects.toThrow(/SUPABASE_URL/);
  });
});
