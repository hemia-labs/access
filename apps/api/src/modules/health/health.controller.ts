import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('startup')
  startup() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(200)
  async ready(@Res() response: Response) {
    const result = await this.health.ready();
    if (result.status !== 'ok') {
      return response.status(503).json(result);
    }
    return response.status(200).json(result);
  }
}
