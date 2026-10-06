import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';

/**
 * Global cache module backing ReportsService's dashboard cache. Uses real
 * Redis when REDIS_URL is configured (the production-correct choice — an
 * in-process cache doesn't work once the backend runs as more than one
 * instance, which an in-memory-only cache would silently get wrong rather
 * than fail loudly). Falls back to cache-manager's default in-memory store
 * when REDIS_URL is unset, so local dev works without provisioning Redis —
 * that fallback is single-instance-only and NOT what production should run
 * on; see .env.example.
 */
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        // Both branches return the same shape (a Keyv-backed store) so this
        // factory has one consistent return type — a bare Keyv() with no
        // adapter is its own built-in in-memory store, used as the local-
        // dev fallback when REDIS_URL isn't configured.
        const store = redisUrl ? new KeyvRedis(redisUrl) : undefined;
        return { stores: [new Keyv(store ? { store } : undefined)] };
      },
    }),
  ],
  exports: [CacheModule],
})
export class AppCacheModule {}
