import {
  LegalConsumerContextDto,
  LegalOrganizationContextDto,
  LegalOrganizationsValidateDto,
} from './dtos/legal-consumer-context.dto';
import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import type { AccessRequest } from '../../common/auth/access-actor.type';
import { AccessContextService } from './access-context.service';
import { CheckAccessDto } from './dtos/check-access.dto';
import { ResolveContextDto } from './dtos/resolve-context.dto';

@UseGuards(AccessAuthGuard)
@Controller()
export class AccessContextController {
  constructor(private readonly accessContext: AccessContextService) {}

  @Get('v1/me')
  me(@Req() request: AccessRequest) {
    return this.accessContext.me(request.accessActor!);
  }

  @Get('v1/me/organizations')
  organizations(@Req() request: AccessRequest) {
    return this.accessContext.organizations(request.accessActor!);
  }

  @Get('v1/me/context')
  context(@Req() request: AccessRequest, @Query('product') product?: string) {
    return this.accessContext.context(request.accessActor!, product);
  }

  @Post('v1/me/context/resolve')
  @Header('Cache-Control', 'no-store')
  resolve(@Req() request: AccessRequest, @Body() dto: ResolveContextDto) {
    return this.accessContext.resolve(
      request.accessActor!,
      dto.organization_id,
      dto.audience,
      dto.product_code,
    );
  }

  @Header('Cache-Control', 'no-store')
  @Post('v1/internal/legal/organizations/validate')
  legalOrganizations(
    @Req() request: AccessRequest,
    @Body() dto: LegalOrganizationsValidateDto,
  ) {
    return this.accessContext.legalOrganizations(
      request.accessActor!,
      dto.organization_ids,
    );
  }
  @Header('Cache-Control', 'no-store')
  @Post('v1/internal/legal/organization-context')
  legalOrganizationContext(
    @Req() request: AccessRequest,
    @Body() dto: LegalOrganizationContextDto,
  ) {
    return this.accessContext.legalOrganizations(
      request.accessActor!,
      [dto.organization_id],
      true,
    );
  }

  @Header('Cache-Control', 'no-store')
  @Post('v1/internal/legal/consumer-context')
  legalConsumerContext(
    @Req() request: AccessRequest,
    @Body() dto: LegalConsumerContextDto,
  ) {
    return this.accessContext.legalConsumerContext(request.accessActor!, dto);
  }

  @Post('v1/access/check')
  check(@Req() request: AccessRequest, @Body() dto: CheckAccessDto) {
    return this.accessContext.check(
      request.accessActor!,
      dto.organization_id,
      dto.permission,
    );
  }
}
