import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AssignRoleDto } from './dtos/assign-role.dto';
import { CreateRoleDto } from './dtos/create-role.dto';
import { UpdateRoleDto } from './dtos/update-role.dto';
import { RolesService } from './roles.service';

@UseGuards(AccessAuthGuard)
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('v1/roles')
  @AccessPermission('role.read', { global: true })
  findGlobalRoles() {
    return this.roles.findGlobalRoles();
  }

  @Get('v1/permissions')
  @AccessPermission('role.read', { global: true })
  findPermissions() {
    return this.roles.findPermissions();
  }

  @Post('v1/organizations/:organizationId/roles')
  @AccessPermission('role.assign')
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.roles.createOrganizationRole(organizationId, dto);
  }

  @Get('v1/organizations/:organizationId/roles')
  @AccessPermission('role.read')
  findOrganizationRoles(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.roles.findOrganizationRoles(organizationId);
  }

  @Patch('v1/organizations/:organizationId/roles/:roleId')
  @AccessPermission('role.assign')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.updateOrganizationRole(organizationId, roleId, dto);
  }

  @Delete('v1/organizations/:organizationId/roles/:roleId')
  @AccessPermission('role.revoke')
  remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.roles.removeOrganizationRole(organizationId, roleId);
  }

  @Post('v1/organizations/:organizationId/memberships/:membershipId/roles')
  @AccessPermission('role.assign')
  assignRole(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.roles.assignMembershipRole(
      request.accessActor!,
      organizationId,
      membershipId,
      dto,
    );
  }

  @Delete('v1/organizations/:organizationId/memberships/:membershipId/roles/:roleId')
  @AccessPermission('role.revoke')
  revokeRole(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.roles.revokeMembershipRole(
      request.accessActor!,
      organizationId,
      membershipId,
      roleId,
    );
  }
}
