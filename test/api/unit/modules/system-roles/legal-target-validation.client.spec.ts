import { ConfigService } from '@nestjs/config';
import { LegalTargetValidationClient } from '../../../../../apps/api/src/modules/system-roles/legal-target-validation.client';
const id = '00000000-0000-4000-8000-000000000001';
const parent = '00000000-0000-4000-8000-000000000002';
const token = {
  access_token: 'private-token',
  token_type: 'Bearer',
  expires_in: 900,
  scope: 'legal.authorization.targets.validate',
};
const row = {
  id,
  target_type: 'legal_application',
  valid: true,
  status: 'active',
  issuer_id: parent,
  reason: null,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe('Legal target validation client', () => {
  let fetchMock: jest.SpyInstance;
  let client: LegalTargetValidationClient;
  let values: Record<string, string>;
  beforeEach(() => {
    values = {
      LEGAL_VALIDATION_TOKEN_URL: 'http://localhost:4000/oauth/token',
      LEGAL_VALIDATION_URL:
        'http://localhost:3017/v1/internal/authorization/targets/validate',
      LEGAL_VALIDATION_CLIENT_SECRET: 'private-secret',
    };
    client = new LegalTargetValidationClient({
      get: (key: string) => values[key],
    } as ConfigService);
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());
  const unavailable = {
    code: 'ACCESS_LEGAL_VALIDATION_UNAVAILABLE',
    status: 503,
  };
  function replies(body: unknown) {
    fetchMock
      .mockResolvedValueOnce(response(token))
      .mockResolvedValueOnce(response(body));
  }
  it('obtains dedicated tokens and never caches decisions', async () => {
    for (let i = 0; i < 2; i++) {
      replies({ valid: true, results: [row] });
      await expect(client.validate('legal_application', [id])).resolves.toEqual(
        [row],
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchMock.mock.calls as [unknown, RequestInit][];
    const tokenRequest = calls[0][1];
    expect((tokenRequest.body as URLSearchParams).get('client_id')).toBe(
      'access-legal-validator',
    );
    expect(tokenRequest.redirect).toBe('error');
    const validationRequest = calls[1][1];
    expect(validationRequest.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer private-token' }),
    );
    expect(JSON.parse(validationRequest.body as string)).toEqual({
      target_type: 'legal_application',
      ids: [id],
    });
  });
  it.each([[], [id, id], ['bad'], Array(1001).fill(id)])(
    'rejects invalid input without network (%#)',
    async (...ids: string[]) => {
      await expect(
        client.validate('legal_application', ids),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    { valid: true, results: [] },
    { valid: true, results: [row, row] },
    { valid: true, results: [{ ...row, id: parent }] },
    { valid: true, results: [{ ...row, target_type: 'legal_issuer' }] },
    { valid: true, results: [{ ...row, issuer_id: null }] },
    { valid: true, results: [{ ...row, status: 'archived' }] },
    { valid: false, results: [row] },
    { valid: true, results: [{ ...row, reason: 'unknown' }] },
  ])('fails closed on inconsistent responses (%#)', async (body) => {
    replies(body);
    await expect(
      client.validate('legal_application', [id]),
    ).rejects.toMatchObject(unavailable);
  });
  it.each(['not_found', 'inactive', 'parent_unavailable'])(
    'rejects negative result: %s',
    async (reason) => {
      replies({
        valid: false,
        results: [
          {
            ...row,
            valid: false,
            reason,
            status:
              reason === 'not_found'
                ? null
                : reason === 'inactive'
                  ? 'inactive'
                  : 'active',
            issuer_id: reason === 'not_found' ? null : parent,
          },
        ],
      });
      await expect(
        client.validate('legal_application', [id]),
      ).rejects.toMatchObject({
        code: 'ACCESS_INVALID_LEGAL_TARGETS',
        status: 400,
      });
    },
  );
  it.each([401, 403, 500, 503])(
    'does not retry upstream HTTP %s',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(response(token))
        .mockResolvedValueOnce(response({}, status));
      await expect(
        client.validate('legal_application', [id]),
      ).rejects.toMatchObject(unavailable);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects expired credentials and network errors without leaking secrets', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...token, expires_in: 0 }));
    await expect(
      client.validate('legal_application', [id]),
    ).rejects.toMatchObject(unavailable);
    fetchMock.mockRejectedValueOnce(new Error('private-secret timeout'));
    await expect(
      client.validate('legal_application', [id]),
    ).rejects.toMatchObject({
      ...unavailable,
      message: 'Legal target validation unavailable',
    });
  });
  it('rejects unsafe URLs before requesting tokens', async () => {
    values.LEGAL_VALIDATION_URL = 'http://remote.example/validate';
    await expect(
      client.validate('legal_application', [id]),
    ).rejects.toMatchObject(unavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
