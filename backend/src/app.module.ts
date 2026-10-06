import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SafesModule } from './safes/safes.module';
import { AuditModule } from './audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { CategoriesModule } from './categories/categories.module';
import { PartiesModule } from './parties/parties.module';
import { CouriersModule } from './couriers/couriers.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReconciliationsModule } from './reconciliations/reconciliations.module';
import { SettingsModule } from './settings/settings.module';
import { ImportModule } from './import/import.module';
import { PendingActionsModule } from './pending-actions/pending-actions.module';
import { AppCacheModule } from './common/app-cache.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ApprovalInterceptor } from './common/interceptors/approval.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    // Must be registered first, per @sentry/nestjs's setup requirements —
    // a no-op when SENTRY_DSN is unset (see instrument.ts, imported first
    // in main.ts).
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    // Structured JSON logs (request/response lines + anything logged via
    // nestjs-pino's Logger) in production; pretty-printed in dev. Replaces
    // Nest's default console Logger as the app-wide logger in main.ts.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        // Never log the httpOnly refresh-token cookie or the Authorization
        // bearer token, even at debug level.
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url === '/' },
      },
    }),
    // Rate-limit counters are shared via Redis (same REDIS_URL as
    // AppCacheModule's dashboard cache) when configured — required for
    // correct behavior once this runs as more than one backend instance,
    // since each process would otherwise enforce its own separate 100
    // req/min counter. Falls back to @nestjs/throttler's built-in
    // in-memory store when REDIS_URL is unset (storage: undefined), same
    // no-Redis-configured fallback pattern as AppCacheModule.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        return {
          throttlers: [{ ttl: 60_000, limit: 100 }],
          storage: redisUrl ? new ThrottlerStorageRedisService(redisUrl) : undefined,
        };
      },
    }),
    AppCacheModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    SafesModule,
    AuditModule,
    ReportsModule,
    CategoriesModule,
    PartiesModule,
    CouriersModule,
    TransactionsModule,
    ReconciliationsModule,
    SettingsModule,
    ImportModule,
    PendingActionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: rate-limit guard, then JWT auth (populates request.user
    // unless @Public()), then role/permission checks.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // ApprovalInterceptor runs first (outermost) so it can short-circuit an
    // EMPLOYEE's @RequiresApproval() request before it reaches the
    // controller — AuditInterceptor never sees a queued request, only ones
    // that actually executed.
    { provide: APP_INTERCEPTOR, useClass: ApprovalInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
