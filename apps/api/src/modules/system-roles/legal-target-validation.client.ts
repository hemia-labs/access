import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { AccessError } from '../../common/errors/access-error';

export type LegalTargetType = 'legal_issuer' | 'legal_application';
export type LegalTarget = {
  id: string;
  target_type: LegalTargetType;
  valid: boolean;
  status: string | null;
  issuer_id: string | null;
  reason: 'not_found' | 'inactive' | 'parent_unavailable' | null;
};
const scope = 'legal.authorization.targets.validate';
const reasons: unknown[] = [
  null,
  'not_found',
  'inactive',
  'parent_unavailable',
];

@Injectable()
export class LegalTargetValidationClient {
  constructor(private readonly config: ConfigService) {}

  // Call before opening the authorization transaction. Never cache decisions.
  async validate(
    targetType: LegalTargetType,
    ids: string[],
  ): Promise<LegalTarget[]> {
    if (
      !['legal_issuer', 'legal_application'].includes(targetType) ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== 'string' || !isUUID(id, 'all'))
    )
      throw new AccessError(
        'ACCESS_INVALID_LEGAL_TARGETS',
        'Invalid Legal target batch',
      );
    const normalized = ids.map((id) => id.toLowerCase());
    if (new Set(normalized).size !== normalized.length)
      throw new AccessError(
        'ACCESS_INVALID_LEGAL_TARGETS',
        'Duplicate Legal targets',
      );
    let result: { valid: boolean; results: LegalTarget[] };
    try {
      const tokenUrl = this.url('LEGAL_VALIDATION_TOKEN_URL');
      const validationUrl = this.url('LEGAL_VALIDATION_URL');
      const secret = this.config.get<string>('LEGAL_VALIDATION_CLIENT_SECRET');
      if (!secret) throw new Error();
      const token = await this.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'access-legal-validator',
          client_secret: secret,
          scope,
        }),
        'application/x-www-form-urlencoded',
      );
      if (
        !record(token) ||
        typeof token.access_token !== 'string' ||
        !token.access_token ||
        token.token_type !== 'Bearer' ||
        typeof token.expires_in !== 'number' ||
        !Number.isFinite(token.expires_in) ||
        token.expires_in <= 0 ||
        typeof token.scope !== 'string' ||
        !token.scope.split(/\s+/).includes(scope)
      )
        throw new Error();
      const response = await this.post(
        validationUrl,
        JSON.stringify({ target_type: targetType, ids: normalized }),
        'application/json',
        token.access_token,
      );
      if (
        !record(response) ||
        typeof response.valid !== 'boolean' ||
        !Array.isArray(response.results) ||
        response.results.length !== normalized.length
      )
        throw new Error();
      const results: LegalTarget[] = [];
      for (const [index, row] of response.results.entries()) {
        if (
          !record(row) ||
          row.id !== normalized[index] ||
          row.target_type !== targetType ||
          typeof row.valid !== 'boolean' ||
          !(row.status === null || typeof row.status === 'string') ||
          !(
            row.issuer_id === null ||
            (typeof row.issuer_id === 'string' && isUUID(row.issuer_id, 'all'))
          ) ||
          !reasons.includes(row.reason)
        )
          throw new Error();
        if (targetType === 'legal_issuer' && row.issuer_id !== null)
          throw new Error();
        if (row.reason === 'not_found') {
          if (row.valid || row.status !== null || row.issuer_id !== null)
            throw new Error();
        } else {
          if (
            typeof row.status !== 'string' ||
            (targetType === 'legal_application' && row.issuer_id === null)
          )
            throw new Error();
          if (row.reason === null && (!row.valid || row.status !== 'active'))
            throw new Error();
          if (
            row.reason === 'inactive' &&
            (row.valid || row.status === 'active')
          )
            throw new Error();
          if (
            row.reason === 'parent_unavailable' &&
            (row.valid ||
              row.status !== 'active' ||
              targetType !== 'legal_application')
          )
            throw new Error();
        }
        results.push(row as LegalTarget);
      }
      if (response.valid !== results.every((row) => row.valid))
        throw new Error();
      result = { valid: response.valid, results };
    } catch {
      // Do not expose tokens, credentials, resource details or upstream bodies.
      throw new AccessError(
        'ACCESS_LEGAL_VALIDATION_UNAVAILABLE',
        'Legal target validation unavailable',
        503,
      );
    }
    if (!result.valid)
      throw new AccessError(
        'ACCESS_INVALID_LEGAL_TARGETS',
        'One or more Legal targets are unavailable',
        400,
      );
    return result.results;
  }

  private url(key: string): URL {
    const value = this.config.get<string>(key);
    if (!value) throw new Error();
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          local &&
          process.env.NODE_ENV !== 'production'
        ))
    )
      throw new Error();
    return url;
  }

  private async post(
    url: URL,
    body: string | URLSearchParams,
    contentType: string,
    token?: string,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'content-type': contentType,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error();
    return response.json();
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
