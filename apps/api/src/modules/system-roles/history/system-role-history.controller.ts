import { SystemRoleCatalogService } from '../catalogs/system-role-catalog.service';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../../../common/auth/access-auth.guard';
import type { AccessRequest } from '../../../common/auth/access-actor.type';
import { SystemRoleHistoryService } from './system-role-history.service';
@Controller('v1/system-roles')
@UseGuards(AccessAuthGuard)
export class SystemRoleHistoryController {
  constructor(
    private readonly history: SystemRoleHistoryService,
    private readonly catalog: SystemRoleCatalogService,
  ) {}
  @Get('catalogs')
  @Header('Cache-Control', 'no-store')
  listCatalogs(@Req() req: AccessRequest) {
    return this.catalog.list(req.accessActor!);
  }
  @Post('catalogs/billing/v1')
  registerBilling(@Req() req: AccessRequest, @Body() body: unknown) {
    return this.catalog.registerBilling(req.accessActor!, body);
  }
  @Post('catalogs/legal/v2')
  publishLegalV2(@Req() req: AccessRequest, @Body() body: unknown) {
    return this.catalog.registerLegalV2(req.accessActor!, body);
  }
  @Post('catalogs/legal/v1')
  registerLegal(@Req() req: AccessRequest, @Body() body: unknown) {
    return this.catalog.registerLegal(req.accessActor!, body);
  }
  @Post('assignments')
  createAssignment(@Req() req: AccessRequest, @Body() body: unknown) {
    return this.history.createAssignment(req.accessActor!, body);
  }
  @Post('delegations')
  createDelegation(@Req() req: AccessRequest, @Body() body: unknown) {
    return this.history.createDelegation(req.accessActor!, body);
  }
  // Keep body unknown: service validation rejects unknown fields before a global
  // whitelist pipe can strip them. Actor always comes from the authentication guard.
  @Post('assignments/:id/replacements')
  replaceAssignment(
    @Req() req: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.history.replaceAssignment(req.accessActor!, id, body);
  }
  @Post('assignments/:id/revoke')
  revokeAssignment(
    @Req() req: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.history.revokeAssignment(req.accessActor!, id, body);
  }
  @Post('delegations/:id/replacements')
  replaceDelegation(
    @Req() req: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.history.replaceDelegation(req.accessActor!, id, body);
  }
  @Post('delegations/:id/revoke')
  revokeDelegation(
    @Req() req: AccessRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.history.revokeDelegation(req.accessActor!, id, body);
  }
}
