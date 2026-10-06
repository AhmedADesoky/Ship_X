import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { AppModule } from './app.module';

// JWT_SECRET/JWT_REFRESH_SECRET fall back to well-known dev placeholder
// strings elsewhere in the auth code (for local-dev convenience) — but if
// those env vars are still unset when NODE_ENV=production, the app must
// refuse to start rather than silently issue tokens anyone can forge by
// signing with the public fallback string.
function assertProductionSecretsPresent(config: ConfigService) {
  if (config.get<string>('NODE_ENV') !== 'production') return;
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !config.get<string>(key));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production with missing secret(s): ${missing.join(', ')}. ` +
        'Set them in the environment before deploying — the dev fallback values are public and forgeable.',
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  assertProductionSecretsPresent(config);

  app.use(
    helmet({
      hsts: { maxAge: 15552000, includeSubDomains: true },
    }),
  );
  app.use(cookieParser());
  app.use(compression());
  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Lets PrismaService.onModuleDestroy() ($disconnect()) actually run on
  // SIGTERM — without this, a container orchestrator's redeploy signal
  // doesn't trigger Nest's lifecycle hooks at all, leaving DB connections
  // open until they time out on their own.
  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
}
bootstrap();
