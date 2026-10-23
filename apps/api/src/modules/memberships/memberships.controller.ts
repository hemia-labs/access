import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import { AccessPermission } from '../../common/auth/access-permission.decorator';
import type { AccessRequest } from '../../common/auth/access-actor.type';
import { AccessError } from '../../common/errors/access-error';
import { CreateMembershipDto } from './dtos/create-membership.dto';
import { UpdateMembershipDto } from './dtos/update-membership.dto';
import { MembershipsService } from './memberships.service';

@Controller('v1/organizations/:organizationId/memberships')
@UseGuards(AccessAuthGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @AccessPermission('membership.read')
  findAll(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.memberships.findAll(organizationId);
  }

  @Post()
  @AccessPermission('membership.invite')
  create(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateMembershipDto,
  ) {
    return this.memberships.create(request.accessActor!, organizationId, dto);
  }

  @Get(':membershipId')
  @AccessPermission('membership.read')
  findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.memberships.findOne(organizationId, membershipId);
  }

  @Patch(':membershipId')
  @AccessPermission('membership.invite')
  update(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.memberships.update(
      request.accessActor!,
      organizationId,
      membershipId,
      dto,
    );
  }

  @Post(':membershipId/suspend')
  @AccessPermission('membership.suspend')
  suspend(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: unknown,
  ) {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length > 0)
    ) {
      throw new AccessError(
        'ACCESS_VALIDATION_ERROR',
        'Membership suspension does not accept request fields.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.memberships.setStatus(
      request.accessActor!,
      organizationId,
      membershipId,
      'suspended',
    );
  }

  @Post(':membershipId/activate')
  @AccessPermission('membership.invite')
  activate(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.memberships.setStatus(
      request.accessActor!,
      organizationId,
      membershipId,
      'active',
    );
  }

  @Post(':membershipId/revoke')
  @AccessPermission('membership.revoke')
  revoke(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.memberships.setStatus(
      request.accessActor!,
      organizationId,
      membershipId,
      'revoked',
    );
  }
}
