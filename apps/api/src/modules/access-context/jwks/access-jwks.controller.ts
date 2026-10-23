import { Controller, Get } from '@nestjs/common';
import { AccessJwksService } from './access-jwks.service';

@Controller('.well-known')
export class AccessJwksController {
  constructor(private readonly jwks: AccessJwksService) {}

  @Get('jwks.json')
  getPublicJwks() {
    return this.jwks.getPublicJwks();
  }
}
