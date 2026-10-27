import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AccessJwksService } from '../access-context/jwks/access-jwks.service';
import { IdentityReferencesService } from '../identity-references/identity-references.service';
import { TrustedIssuer } from '../../config/access.config';
import { InvitationsService } from './invitations.service';
import {
  AcceptInvitationDto,
  AcceptInvitationProofDto,
} from './dtos/invitation.dto';

@Controller('v1/public/invitations')
export class PublicInvitationsController {
  private readonly keys = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();
  constructor(
    private readonly invitations: InvitationsService,
    private readonly jwks: AccessJwksService,
    private readonly identities: IdentityReferencesService,
    private readonly config: ConfigService,
  ) {}

  @Post('preview')
  async preview(
    @Req() request: Request,
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.invitations.rateLimit(`preview:${request.ip}`, 120);
    response.setHeader('Cache-Control', 'no-store');
    const invitation = await this.invitations.preview(dto.token);
    if (
      invitation.identityIssuerHint &&
      invitation.identityIssuerHint !==
        this.config.get<string>('access.identityIntrospection.issuer')
    ) {
      throw new BadRequestException(
        'This invitation requires a different identity issuer',
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const proof = await this.jwks.signContextToken(
      {
        email: invitation.emailNormalized,
        token_hash: invitation.tokenHash,
      },
      invitation.id,
      'hemia-id-invitation',
      {
        issuedAt: now,
        expiresAt: Math.min(
          now + 300,
          Math.floor(invitation.expiresAt.getTime() / 1000),
        ),
        type: 'invitation-registration+jwt',
      },
    );
    return {
      email: invitation.emailNormalized,
      organization: invitation.organization.name,
      expiresAt: invitation.expiresAt,
      proof,
    };
  }

  @Post('accept')
  async accept(@Req() request: Request, @Body() dto: AcceptInvitationProofDto) {
    this.invitations.rateLimit(`proof:${request.ip}`, 120);
    const issuer = this.config.getOrThrow<string>(
      'access.identityIntrospection.issuer',
    );
    const trusted = this.config
      .get<TrustedIssuer[]>('access.trustedIssuers', [])
      .find((i) => i.issuer === issuer);
    if (!trusted)
      throw new UnauthorizedException('Invitation issuer is not configured');
    let key = this.keys.get(trusted.jwksUri);
    if (!key) {
      key = createRemoteJWKSet(new URL(trusted.jwksUri));
      this.keys.set(trusted.jwksUri, key);
    }
    const { payload, protectedHeader } = await jwtVerify(
      dto.identity_proof,
      key,
      {
        issuer,
        audience: 'hemia-access-invitation-accept',
        algorithms: ['RS256'],
        maxTokenAge: '60s',
      },
    ).catch(() => {
      throw new UnauthorizedException('Invalid identity proof');
    });
    if (
      protectedHeader.typ !== 'invitation-accept+jwt' ||
      typeof payload.sub !== 'string' ||
      !payload.sub.trim() ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true ||
      payload.token_hash !==
        createHash('sha256').update(dto.token).digest('hex')
    ) {
      throw new BadRequestException('Invalid invitation identity proof');
    }
    const invitation = await this.invitations.preview(dto.token);
    if (
      payload.email.trim().toLowerCase() !== invitation.emailNormalized ||
      (invitation.identityIssuerHint &&
        invitation.identityIssuerHint !== issuer)
    ) {
      throw new BadRequestException('Invitation email does not match identity');
    }
    const identity = await this.identities.findOrCreateFromClaims({
      issuer,
      subjectId: payload.sub,
      identityType: trusted.identityType,
      email: payload.email,
      displayName: null,
      avatarUrl: null,
    });
    return this.invitations.accept(
      {
        identityReferenceId: identity.id,
        issuer,
        subjectId: identity.subjectId,
        identityType: identity.identityType,
      },
      dto,
    );
  }
}
