import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const AVATARS_BUCKET = 'avatars';

// Allowlist checked against the buffer's actual magic bytes (via
// file-type), never the client-supplied mimetype/filename — a client can
// set those to anything regardless of the real file content. Deliberately
// excludes SVG (an XML/text format that can embed <script>, the exact
// stored-XSS vector this check exists to close).
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Thin wrapper around the Supabase Storage API used for employee profile
 * avatars. Uses the service-role key (server-side only, never sent to the
 * frontend) so it can manage a private bucket and issue signed URLs.
 */
@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private client: SupabaseClient | null = null;

  constructor(private config: ConfigService) {}

  private getClient(): SupabaseClient {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL');
      const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) {
        throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not configured');
      }
      this.client = createClient(url, key, { auth: { persistSession: false } });
    }
    return this.client;
  }

  async onModuleInit() {
    try {
      await this.ensureAvatarsBucket();
    } catch (err) {
      // Non-fatal: avatar upload will retry bucket creation lazily on first
      // use, and the rest of the app doesn't depend on Storage being up.
      this.logger.warn(`Could not verify/create the "${AVATARS_BUCKET}" bucket on startup: ${(err as Error).message}`);
    }
  }

  private async ensureAvatarsBucket() {
    const client = this.getClient();
    const { data: buckets, error: listError } = await client.storage.listBuckets();
    if (listError) throw listError;
    if (buckets?.some((b) => b.name === AVATARS_BUCKET)) return;

    const { error: createError } = await client.storage.createBucket(AVATARS_BUCKET, {
      public: false,
      fileSizeLimit: '5MB',
    });
    // Ignore a race where another instance created it first.
    if (createError && !/already exists/i.test(createError.message)) {
      throw createError;
    }
    this.logger.log(`Created Supabase Storage bucket "${AVATARS_BUCKET}"`);
  }

  /** Uploads (overwriting any existing file) and returns a long-lived signed URL. */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<string> {
    // file-type v22+ is ESM-only; this tsconfig's CommonJS moduleResolution
    // can't resolve its type declarations, though the dynamic import works
    // fine at runtime.
    // @ts-expect-error -- see comment above
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_AVATAR_TYPES.has(detected.mime)) {
      throw new BadRequestException('Only JPEG, PNG, or WebP images are allowed');
    }

    await this.ensureAvatarsBucket();
    const client = this.getClient();
    // The extension/content-type used for storage come from the detected
    // real file type, not the client-supplied filename/mimetype.
    const path = `${userId}/avatar.${detected.ext}`;

    const { error: uploadError } = await client.storage.from(AVATARS_BUCKET).upload(path, file.buffer, {
      contentType: detected.mime,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    // Bucket is private, so signed URLs (not the public URL) are what the
    // frontend can actually load. Ten years is effectively "until removed".
    const { data, error: signError } = await client.storage
      .from(AVATARS_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signError || !data) throw signError ?? new Error('Failed to sign avatar URL');
    return data.signedUrl;
  }

  async removeAvatar(userId: string): Promise<void> {
    const client = this.getClient();
    const { data: files } = await client.storage.from(AVATARS_BUCKET).list(userId);
    if (files && files.length > 0) {
      await client.storage.from(AVATARS_BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
    }
  }
}
