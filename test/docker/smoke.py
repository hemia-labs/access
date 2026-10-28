"""Production images with disposable PostgreSQL, Redis, RabbitMQ and signing key."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]

with tempfile.TemporaryDirectory(prefix='access-docker-') as directory:
    directory = Path(directory)
    password = secrets.token_hex(24)
    key = directory / 'signing.pem'
    key.write_bytes(subprocess.check_output(['openssl', 'genpkey', '-algorithm', 'RSA',
        '-pkeyopt', 'rsa_keygen_bits:2048'], stderr=subprocess.DEVNULL))
    key.chmod(0o444)  # Synthetic disposable key, readable by the non-root container.
    config = {
        'NODE_ENV': 'production', 'DB_HOST': 'smoke-db', 'DB_PORT': '5432',
        'DB_USERNAME': 'access', 'DB_PASSWORD': password, 'DB_DATABASE': 'access',
        'ACCESS_ISSUER': 'https://access.example.test',
        'ACCESS_TRUSTED_ISSUERS': 'https://identity.example.test',
        'IDENTITY_JWKS_URI': 'https://identity.example.test/.well-known/jwks.json',
        'ACCESS_REDIS_HOST': 'smoke-redis',
        'AMQP_URL': f'amqp://access:{password}@smoke-rabbit:5672',
        'SEED_ADMIN_ISSUER': 'https://identity.example.test',
        'SEED_ADMIN_SUBJECT_ID': 'synthetic-smoke-admin',
        'SEED_ADMIN_EMAIL': 'admin@example.test',
    }
    env_file = directory / 'production.env'
    env_file.write_text(''.join(f'{name}={value}\n' for name, value in config.items()))
    env_file.chmod(0o600)
    override = directory / 'compose.json'
    override.write_text(json.dumps({'services': {
        'smoke-db': {
            'image': 'postgres:18.4',
            'environment': {'POSTGRES_USER': 'access', 'POSTGRES_PASSWORD': password, 'POSTGRES_DB': 'access'},
            'tmpfs': ['/var/lib/postgresql'],
            'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U access'], 'interval': '1s', 'timeout': '3s', 'retries': 60},
        },
        'smoke-redis': {
            'image': 'redis:8-alpine', 'command': ['redis-server', '--save', '', '--appendonly', 'no'],
            'healthcheck': {'test': ['CMD', 'redis-cli', 'ping'], 'interval': '1s', 'timeout': '3s', 'retries': 60},
        },
        'smoke-rabbit': {
            'image': 'rabbitmq:4-alpine',
            'environment': {'RABBITMQ_DEFAULT_USER': 'access', 'RABBITMQ_DEFAULT_PASS': password},
            'healthcheck': {'test': ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'], 'interval': '3s', 'timeout': '5s', 'retries': 60},
        },
        'api': {'depends_on': {service: {'condition': 'service_healthy'}
                              for service in ['smoke-db', 'smoke-redis', 'smoke-rabbit']}},
    }}))
    environment = {**os.environ, 'ACCESS_ENV_FILE': str(env_file),
                   'ACCESS_JWKS_PRIVATE_KEY_FILE': str(key),
                   'ACCESS_PUBLIC_URL': 'https://access.example.test',
                   'ACCESS_BIND_ADDRESS': '127.0.0.1', 'ACCESS_HTTP_PORT': '0'}
    compose = ['docker', 'compose', '--env-file', '/dev/null', '-p',
               'access-smoke-' + secrets.token_hex(4), '-f', str(ROOT / 'docker-compose.yml'), '-f', str(override)]

    def run(*args, capture=False, quiet_failure=False):
        result = subprocess.run(compose + list(args), env=environment, cwd=ROOT,
                                text=True, capture_output=capture, timeout=300)
        if result.returncode and capture and not quiet_failure:
            print((result.stdout + result.stderr).replace(password, '[REDACTED]'), flush=True)
        result.check_returncode()
        return result.stdout

    def check_http(path, assertion, web=False, quiet_failure=False):
        origin = 'http://web:3000' if web else 'http://127.0.0.1:3019'
        script = (f"fetch('{origin}{path}',{{signal:AbortSignal.timeout(5000)}}).then(async r=>{{"
                  "const text=await r.text(); let body; try{body=JSON.parse(text)}catch{};"
                  f"if(!({assertion}))throw Error('Failed probe: {path} '+r.status);"
                  "}).catch(e=>{console.error(e.message);process.exit(1)})")
        return run('exec', '-T', 'api', 'node', '-e', script, capture=True, quiet_failure=quiet_failure)

    try:
        run('up', '-d', '--no-build', 'api')
        for attempt in range(60):
            try:
                check_http('/health/live', "r.status===200 && body.status==='ok'", quiet_failure=True)
                break
            except subprocess.CalledProcessError:
                time.sleep(1)
        else:
            run('logs', '--tail', '50', 'api', capture=True)
            raise RuntimeError('Access did not start')
        check_http('/health/ready', "r.status===503 && body.reason==='pending_migrations'")
        print('PASS: startup refuses readiness without applying migrations', flush=True)
        run('run', '--rm', '--no-deps', 'api', 'node', 'node_modules/typeorm/cli.js',
            'migration:run', '-d', 'dist/data-source.js', capture=True)
        run('run', '--rm', '--no-deps', 'api', 'node', 'dist/src/database/seeds/run-seeds.js', capture=True)
        run('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
        check_http('/health/ready', "r.status===200 && body.status==='ok'", web=True)
        check_http('/.well-known/jwks.json', "r.status===200 && body.keys.length===1 && !body.keys[0].d", web=True)
        check_http('/v1/me', 'r.status===401', web=True)
        check_http('/', "r.status===200 && text.includes('Hemia Access')", web=True)
        runtime_probe = (
            "const fs=require('node:fs'),assert=require('node:assert/strict');"
            "assert.notEqual(process.getuid(),0);"
            "assert.match(fs.readFileSync('/etc/os-release','utf8'),/^ID=debian$/m);"
            "assert(fs.statSync('/etc/ssl/certs/ca-certificates.crt').size>0);"
            "for(const path of ['/usr/local/bin/npm','/usr/local/bin/yarn','/usr/local/include/node'])"
            "assert(!fs.existsSync(path),'Unexpected development tool: '+path);"
        )
        for service in ['api', 'web']:
            run('exec', '-T', service, 'node', '-e', runtime_probe, capture=True)
        print('PASS: minimal Debian/Node runtimes, CA certificates and non-root execution', flush=True)
        jwks_probe = "fetch('http://web:3000/.well-known/jwks.json').then(async r=>console.log(JSON.stringify(await r.json())))"
        before = json.loads(run('exec', '-T', 'api', 'node', '-e', jwks_probe, capture=True))
        print('PASS: production Redis/RabbitMQ, manual migrations/seeds, Next.js, API proxy, public JWKS and authorization', flush=True)
        run('restart', 'api')
        run('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
        check_http('/.well-known/jwks.json', 'r.status===200 && body.keys.length===1', web=True)
        after = json.loads(run('exec', '-T', 'api', 'node', '-e', jwks_probe, capture=True))
        assert before == after, 'Signing identity must not rotate on restart'
        print('PASS: persistent signing key survives API restart', flush=True)
    finally:
        run('down', '-v', '--remove-orphans')
