import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  use(req: Request & { traceId?: string }, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    req.traceId = req.header('x-trace-id') ?? randomUUID();
    res.setHeader('x-trace-id', req.traceId);

    res.on('finish', () => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'hemia-access',
          trace_id: req.traceId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Date.now() - startedAt,
        }),
      );
    });

    next();
  }
}
