import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessError } from './access-error';

const titles: Record<string, string> = {
  ACCESS_UNAUTHENTICATED: 'Unauthenticated',
  ACCESS_TOKEN_INVALID: 'Access token is invalid',
  ACCESS_ISSUER_NOT_ALLOWED: 'Issuer is not allowed',
  ACCESS_VALIDATION_ERROR: 'Validation failed',
  ACCESS_ORGANIZATION_NOT_FOUND: 'Organization not found',
  ACCESS_CONFLICT: 'Conflict',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { traceId?: string }>();
    const response = ctx.getResponse<Response>();
    const status = this.status(exception);
    const code = this.code(exception, status);
    const detail = this.detail(exception);

    response.status(status).json({
      type: `https://errors.hemia.cloud/access/${code.toLowerCase().replaceAll('_', '-')}`,
      title: titles[code] ?? 'Unexpected error',
      status,
      code,
      detail,
      trace_id: request.traceId,
    });
  }

  private status(exception: unknown) {
    if (exception instanceof AccessError) return exception.status;
    if (exception instanceof HttpException) return exception.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private code(exception: unknown, status: number) {
    if (exception instanceof AccessError) return exception.code;
    if (status === HttpStatus.UNAUTHORIZED) return 'ACCESS_UNAUTHENTICATED';
    if (status === HttpStatus.NOT_FOUND) return 'ACCESS_ORGANIZATION_NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'ACCESS_CONFLICT';
    if (status === HttpStatus.BAD_REQUEST) return 'ACCESS_VALIDATION_ERROR';
    return 'ACCESS_INTERNAL_ERROR';
  }

  private detail(exception: unknown) {
    if (exception instanceof Error) return exception.message;
    return 'Unexpected error';
  }
}
