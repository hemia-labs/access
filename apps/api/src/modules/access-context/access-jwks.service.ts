import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from 'crypto';
import { readFileSync } from 'fs';
import { SignJWT } from 'jose';

@Injectable()
export class AccessJwksService {
  private activeKey?: { kid: string; privateKey: KeyObject; publicKey: KeyObject };

  constructor(private readonly config: ConfigService) {}

  async getPublicJwks() {
    const key = this.getActiveKey();
    const jwk = key.publicKey.export({ format: 'jwk' });
    return { keys: [{ ...jwk, kid: key.kid, alg: 'RS256', use: 'sig' }] };
  }

  async signContextToken(
    claims: Record<string, unknown>,
    subjectId: string,
    audience: string,
  ) {
    const key = this.getActiveKey();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer(this.config.getOrThrow<string>('access.issuer'))
      .setSubject(subjectId)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(
        `${this.config.get<number>('access.contextTokenTtlSeconds', 900)}s`,
      )
      .sign(key.privateKey);
  }

  private getActiveKey() {
    if (!this.activeKey) this.activeKey = this.loadKey();
    return this.activeKey;
  }

  private loadKey() {
    const kid = this.config.get<string>('access.jwks.kid', 'access-dev-rs256');
    const path = this.config.get<string>('access.jwks.privateKeyPath');
    if (path) {
      const privateKey = createPrivateKey(readFileSync(path, 'utf8'));
      return { kid, privateKey, publicKey: createPublicKey(privateKey) };
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ACCESS_JWKS_PRIVATE_KEY_PATH is required in production');
    }
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    return { kid, privateKey, publicKey };
  }
}
