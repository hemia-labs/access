import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessPermission } from '../../common/auth/access-permission.decorator';
import type { AccessRequest } from '../../common/auth/access-actor.type';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { UpdateOrganizationDto } from './dtos/update-organization.dto';
import type {
  OrganizationStatus,
  OrganizationType,
} from './entities/organization.entity';
import { OrganizationsService } from './organizations.service';

@Controller('v1/organizations')
@UseGuards(AccessAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @AccessPermission('organization.update', { global: true })
  create(@Req() request: AccessRequest, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(request.accessActor!, dto);
  }

  @Get()
  @AccessPermission('organization.read', { global: true })
  findAll(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.organizations.findAll({
      status: status as OrganizationStatus | undefined,
      type: type as OrganizationType | undefined,
      search,
      limit,
    });
  }

  @Get(':organizationId')
  @AccessPermission('organization.read')
  findOne(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.organizations.findOne(organizationId);
  }

  @Patch(':organizationId')
  @AccessPermission('organization.update')
  update(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizations.update(
      request.accessActor!,
      organizationId,
      dto,
    );
  }

  @Post(':organizationId/suspend')
  @AccessPermission('organization.update')
  suspend(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizations.setStatus(
      request.accessActor!,
      organizationId,
      'suspended',
    );
  }

  @Post(':organizationId/activate')
  @AccessPermission('organization.update')
  activate(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizations.setStatus(
      request.accessActor!,
      organizationId,
      'active',
    );
  }

  @Post(':organizationId/archive')
  @AccessPermission('organization.archive')
  archive(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizations.archive(request.accessActor!, organizationId);
  }
}
