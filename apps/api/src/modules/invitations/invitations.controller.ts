import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import type { AccessRequest } from '../../common/auth/access-actor.type';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  ListInvitationsQueryDto,
} from './dtos/invitation.dto';
import { InvitationsService } from './invitations.service';

@UseGuards(AccessAuthGuard)
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('v1/organizations/:organizationId/invitations')
  create(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.create(request.accessActor!, organizationId, dto);
  }

  @Get('v1/organizations/:organizationId/invitations')
  findAll(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.invitations.findAll(organizationId, request.accessActor!);
  }

  @Get('v1/invitations')
  listAll(
    @Req() request: AccessRequest,
    @Query() query: ListInvitationsQueryDto,
  ) {
    return this.invitations.listAll(query, request.accessActor!);
  }

  @Get('v1/invitations/:invitationId')
  findOne(
    @Req() request: AccessRequest,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.findOne(invitationId, request.accessActor!);
  }

  @Post('v1/invitations/accept')
  accept(@Req() request: AccessRequest, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(request.accessActor!, dto);
  }

  @Post('v1/invitations/:invitationId/revoke')
  revoke(
    @Req() request: AccessRequest,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(request.accessActor!, invitationId);
  }

  @Post('v1/invitations/:invitationId/resend')
  resend(
    @Req() request: AccessRequest,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.resend(request.accessActor!, invitationId);
  }
}
