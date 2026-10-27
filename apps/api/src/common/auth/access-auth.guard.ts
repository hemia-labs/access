import {
  authenticatedActions,
  requireOrganizationAccess,
} from './authorization-mode';
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AccessError } from '../errors/access-error';
import { TrustedIssuer } from '../../config/access.config';
import { IdentityReferencesService } from '../../modules/identity-references/identity-references.service';
import { AccessRequest } from './access-actor.type';
import {
  ACCESS_PERMISSION_KEY,
  AccessPermissionRequirement,
} from './access-permission.decorator';

@Injectable()
export class AccessAuthGuard implements CanActivate {
  private readonly keySets = new Map<string, unknown>();

  constructor(
    private readonly config: ConfigService,
    private readonly identityReferences: IdentityReferencesService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AccessRequest>();
    const token = this.bearerToken(request.headers.authorization);
    request.accessActor =
      token.split('.').length === 3
        ? await this.jwtActor(token)
        : await this.serviceActor(token);

    await this.authorize(context, request);
    return true;
  }

  private async jwtActor(token: string) {
    const unverified = this.decodePayload(token);
    const issuer = typeof unverified.iss === 'string' ? unverified.iss : '';
    const trusted = this.trustedIssuer(issuer);

    if (!trusted) {
      throw new AccessError(
        'ACCESS_ISSUER_NOT_ALLOWED',
        'JWT issuer is not allowed',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { jwtVerify } = await import('jose');
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await this.keySet(trusted),
      {
        issuer: trusted.issuer,
        audience: trusted.audience,
        algorithms: ['RS256'],
      },
    ).catch(() => {
      throw new AccessError(
        'ACCESS_TOKEN_INVALID',
        'JWT validation failed',
        HttpStatus.UNAUTHORIZED,
      );
    });

    if (
      protectedHeader.alg !== 'RS256' ||
      typeof payload.sub !== 'string' ||
      !payload.sub.trim()
    ) {
      throw new AccessError(
        'ACCESS_TOKEN_INVALID',
        'JWT must include RS256 algorithm and sub',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (payload.grant_type === 'client_credentials') {
      const { issuer } = this.config.getOrThrow<{ issuer: string }>(
        'access.identityIntrospection',
      );
      const audience = this.config.get<string>(
        'access.expectedAudience',
        'access-api',
      );
      const now = Math.floor(Date.now() / 1000);
      if (
        payload.iss !== issuer ||
        payload.aud !== audience ||
        protectedHeader.typ !== 'at+jwt' ||
        typeof protectedHeader.kid !== 'string' ||
        !protectedHeader.kid.trim() ||
        typeof payload.client_id !== 'string' ||
        !payload.client_id.trim() ||
        payload.sub !== payload.client_id ||
        typeof payload.scope !== 'string' ||
        typeof payload.jti !== 'string' ||
        !payload.jti.trim() ||
        typeof payload.iat !== 'number' ||
        !Number.isFinite(payload.iat) ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp) ||
        payload.iat <= 0 ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > 600 ||
        payload.iat > now + 30 ||
        payload.session_id !== undefined
      ) {
        throw new AccessError(
          'ACCESS_TOKEN_INVALID',
          'Service JWT contract is invalid',
          HttpStatus.UNAUTHORIZED,
        );
      }

      return this.serviceActor(token, payload.client_id);
    }

    const identity = await this.identityReferences.findOrCreateFromClaims({
      issuer: trusted.issuer,
      subjectId: payload.sub,
      identityType: trusted.identityType,
      email: this.stringClaim(payload.email),
      displayName: this.stringClaim(payload.name),
      avatarUrl: this.stringClaim(payload.picture),
    });

    return {
      identityReferenceId: identity.id,
      issuer: identity.issuer,
      subjectId: identity.subjectId,
      identityType: identity.identityType,
    };
  }

  private async serviceActor(token: string, expectedClientId?: string) {
    const introspection = this.config.getOrThrow<{
      url: string;
      issuer: string;
      clientId: string;
      clientSecret?: string;
    }>('access.identityIntrospection');
    if (!introspection.clientSecret) {
      throw new AccessError(
        'ACCESS_INTROSPECTION_UNAVAILABLE',
        'Identity introspection is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const result = (await fetch(introspection.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: introspection.clientId,
        client_secret: introspection.clientSecret,
        token,
      }),
      signal: AbortSignal.timeout(3_000),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data: unknown = await response.json();
        return data;
      })
      .catch(() => null)) as {
      active?: boolean;
      aud?: string;
      client_id?: string;
      exp?: number;
      scope?: string;
      session_id?: unknown;
    } | null;

    const expectedAudience = this.config.get<string>(
      'access.expectedAudience',
      'access-api',
    );
    if (
      result?.active !== true ||
      result.aud !== expectedAudience ||
      typeof result.client_id !== 'string' ||
      !result.client_id.trim() ||
      (expectedClientId !== undefined &&
        result.client_id !== expectedClientId) ||
      typeof result.scope !== 'string' ||
      typeof result.exp !== 'number' ||
      !Number.isFinite(result.exp) ||
      result.session_id != null ||
      result.exp * 1000 <= Date.now()
    ) {
      throw new AccessError(
        'ACCESS_TOKEN_INVALID',
        'Service token validation failed',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const identity = await this.identityReferences.findOrCreateFromClaims({
      issuer: introspection.issuer,
      subjectId: result.client_id,
      identityType: 'service_account',
      email: null,
      displayName: result.client_id,
      avatarUrl: null,
    });

    return {
      identityReferenceId: identity.id,
      issuer: identity.issuer,
      subjectId: identity.subjectId,
      identityType: identity.identityType,
      scopes: this.scopes(result.scope),
    };
  }

  private async authorize(context: ExecutionContext, request: AccessRequest) {
    const requirement =
      this.reflector.getAllAndOverride<AccessPermissionRequirement>(
        ACCESS_PERMISSION_KEY,
        [context.getHandler(), context.getClass()],
      );
    if (!requirement) return;

    const actor = request.accessActor!;
    if (authenticatedActions(actor)) {
      const value = request.params.organizationId;
      const organizationId = Array.isArray(value) ? value[0] : value;
      if (organizationId)
        await requireOrganizationAccess(this.dataSource, actor, organizationId);
      return;
    }

    if (actor.identityType === 'service_account') {
      if (this.matches(actor.scopes ?? [], requirement.permission)) return;
    } else {
      const organizationId = Array.isArray(request.params.organizationId)
        ? request.params.organizationId[0]
        : request.params.organizationId;
      const allowed = requirement.global
        ? await this.hasHumanPermission(
            actor.identityReferenceId,
            requirement.permission,
            undefined,
            true,
          )
        : (organizationId &&
            (await this.hasHumanPermission(
              actor.identityReferenceId,
              requirement.permission,
              organizationId,
            ))) ||
          (await this.hasHumanPermission(
            actor.identityReferenceId,
            requirement.permission,
            undefined,
            true,
          ));
      if (allowed) return;
    }

    throw new AccessError(
      'ACCESS_FORBIDDEN',
      'Insufficient permission',
      HttpStatus.FORBIDDEN,
    );
  }

  private async hasHumanPermission(
    identityReferenceId: string,
    permission: string,
    organizationId?: string,
    platformOnly = false,
  ) {
    const rows = await this.dataSource.query<Array<{ code: string }>>(
      `SELECT permission.code
       FROM organization_memberships membership
       JOIN organizations organization ON organization.id = membership.organization_id
       JOIN membership_roles membership_role ON membership_role.membership_id = membership.id
       JOIN roles role ON role.id = membership_role.role_id
       JOIN role_permissions role_permission ON role_permission.role_id = role.id
       JOIN permissions permission ON permission.id = role_permission.permission_id
       WHERE membership.identity_reference_id = $1
         AND membership.status = 'active'
         AND organization.status = 'active'
         AND role.status = 'active'
         AND permission.status = 'active'
         AND (membership_role.expires_at IS NULL OR membership_role.expires_at > now())
         AND ($2::uuid IS NULL OR membership.organization_id = $2::uuid)
         AND ($3::boolean = false OR role.scope = 'platform')`,
      [identityReferenceId, organizationId ?? null, platformOnly],
    );
    return this.matches(
      rows.map((row) => row.code),
      permission,
    );
  }

  private scopes(scope?: string) {
    return (scope ?? '').split(/\s+/).filter(Boolean);
  }

  private matches(candidates: string[], permission: string) {
    return candidates.some(
      (candidate) =>
        candidate === '*' ||
        candidate === permission ||
        (candidate.endsWith('.*') &&
          permission.startsWith(candidate.slice(0, -1))),
    );
  }

  private bearerToken(header?: string) {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw new AccessError(
        'ACCESS_UNAUTHENTICATED',
        'Bearer token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return match[1];
  }

  private decodePayload(token: string): { iss?: unknown } {
    const [, encoded] = token.split('.');
    if (!encoded) {
      throw new AccessError(
        'ACCESS_TOKEN_INVALID',
        'JWT is malformed',
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const payload: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload)
      ) {
        throw new Error('JWT payload must be an object');
      }
      return payload;
    } catch {
      throw new AccessError(
        'ACCESS_TOKEN_INVALID',
        'JWT is malformed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private trustedIssuer(issuer: string) {
    return this.config
      .get<TrustedIssuer[]>('access.trustedIssuers', [])
      .find((trusted) => trusted.issuer === issuer);
  }

  private async keySet(trusted: TrustedIssuer) {
    let keySet = this.keySets.get(trusted.issuer);
    if (!keySet) {
      const { createRemoteJWKSet } = await import('jose');
      keySet = createRemoteJWKSet(new URL(trusted.jwksUri));
      this.keySets.set(trusted.issuer, keySet);
    }
    return keySet as never;
  }

  private stringClaim(value: unknown) {
    return typeof value === 'string' && value ? value : null;
  }
}
