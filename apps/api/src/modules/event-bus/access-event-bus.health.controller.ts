import { Controller, Get } from '@nestjs/common';
import { AccessEventBusClient } from './access-event-bus.client';

@Controller('health')
export class AccessEventBusHealthController {
  constructor(private readonly bus: AccessEventBusClient) {}

  @Get('event-bus')
  status() {
    const connected = this.bus.isConnected();
    return {
      service: 'hemia-access',
      transport: 'rabbitmq',
      status: connected ? 'ok' : 'degraded',
      connected,
    };
  }
}
