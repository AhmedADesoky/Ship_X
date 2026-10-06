import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { Logger } from 'nestjs-pino';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  // Reports every exception that reaches this filter to Sentry (a no-op
  // when SENTRY_DSN is unset) before the filter's own handling below runs.
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;

    // Below 500, the message comes from an HttpException we (or a DTO
    // validator) deliberately threw — safe to return as-is. At/above 500,
    // `exception.message` can be raw driver/library text (e.g. a Postgres
    // error string with column/constraint names) that shouldn't reach API
    // clients, so it's replaced with a fixed generic message; the real
    // message/stack is still logged server-side below.
    const message =
      status < 500 && exceptionResponse && typeof exceptionResponse === 'object' && 'message' in exceptionResponse
        ? (exceptionResponse as { message: unknown }).message
        : status < 500 && exception instanceof Error
          ? exception.message
          : 'Internal server error';

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
