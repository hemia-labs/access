import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { environmentFile } from '../../../../../apps/api/src/config/env-file';

describe('environment file loading', () => {
  const originalEnvironment = process.env.NODE_ENV;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'access-env-'));
    writeFileSync(
      join(directory, '.env.production'),
      'DB_HOST=production-db\n',
    );
    writeFileSync(join(directory, '.env.local'), 'DB_HOST=development-db\n');
    writeFileSync(join(directory, '.env'), 'DB_HOST=unselected-db\n');
  });

  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['production', 'production-db'],
    ['development', 'development-db'],
    [undefined, 'development-db'],
  ])('loads the selected file for NODE_ENV=%s', (mode, expected) => {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    const environment: Record<string, string> = {};

    const result = config({
      path: join(directory, environmentFile()),
      processEnv: environment,
      quiet: true,
    });

    expect(result.error).toBeUndefined();
    expect(environment.DB_HOST).toBe(expected);
  });

  it('does not fall back to development credentials when the production file is absent', () => {
    process.env.NODE_ENV = 'production';
    rmSync(join(directory, '.env.production'));
    const environment: Record<string, string> = {};

    config({
      path: join(directory, environmentFile()),
      processEnv: environment,
      quiet: true,
    });

    expect(environment.DB_HOST).toBeUndefined();
  });
});
