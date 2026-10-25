"""Create/validate the immutable deployment assets for an Access release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

TAG = re.compile(r'access-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
DEFAULT_REGISTRY = 'registry.tail41610c.ts.net'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(directory, expected_tag=None, registry_host=None):
    registry_host = registry_host or os.environ.get('REGISTRY_HOST') or DEFAULT_REGISTRY
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', registry_host):
        raise ValueError('Invalid registry hostname')
    directory = Path(directory)
    manifest = json.loads((directory / 'release.json').read_text())
    if manifest.get('schema') != 1 or not TAG.fullmatch(manifest.get('tag', '')):
        raise ValueError('Invalid Access release tag/schema')
    if expected_tag and manifest['tag'] != expected_tag:
        raise ValueError('Release does not match requested tag')
    if not re.fullmatch('[a-f0-9]{40}', manifest.get('commit', '')):
        raise ValueError('Invalid commit')
    if not isinstance(manifest.get('migrations'), dict) or any(
        not re.fullmatch(r'[A-Za-z0-9_-]+\.ts', name) or not re.fullmatch('[a-f0-9]{64}', value)
        for name, value in manifest['migrations'].items()
    ):
        raise ValueError('Invalid migration manifest')
    if manifest.get('registry') != registry_host:
        raise ValueError('Release uses an unexpected registry')
    for service in ['api', 'web']:
        match = re.fullmatch(re.escape(registry_host) + r'/access/(api|web)@sha256:[a-f0-9]{64}', manifest['images'][service])
        if not match or match.group(1) != service:
            raise ValueError('Expected the correct private registry image pinned by digest')
    for name in ['compose.json', 'access-deploy.py']:
        if digest(directory / name) != manifest['files'][name]:
            raise ValueError('Release asset checksum mismatch: ' + name)
    config = json.loads((directory / 'compose.json').read_text())
    if set(config['services']) != {'api', 'web'}:
        raise ValueError('Unexpected services in Access release')
    for service in config['services']:
        if config['services'][service].get('build') or config['services'][service]['image'] != manifest['images'][service]:
            raise ValueError('Compose must use the release images without building')
    return manifest


def create(tag, output):
    if not TAG.fullmatch(tag):
        raise ValueError('Expected access-vMAJOR.MINOR.PATCH')
    root = Path(__file__).resolve().parents[1]
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    config = json.loads(subprocess.check_output([
        'docker', 'compose', '--env-file', '/dev/null', 'config', '--format', 'json'
    ], cwd=root, env={**os.environ, 'ACCESS_ENV_FILE': '/dev/null'}, text=True))
    registry_host = os.environ.get('REGISTRY_HOST') or DEFAULT_REGISTRY
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', registry_host):
        raise ValueError('Invalid registry hostname')
    images = {}
    for service in ['api', 'web']:
        image = f'{registry_host}/access/{service}:{tag}'
        info = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image], text=True))[0]
        prefix = f'{registry_host}/access/{service}@'
        images[service] = next(value for value in info['RepoDigests'] if value.startswith(prefix))
        config['services'][service].pop('build', None)
        config['services'][service]['image'] = images[service]
    config['services']['api']['volumes'][0]['source'] = '${ACCESS_JWKS_PRIVATE_KEY_FILE:?Set the persistent signing key}'
    config['services']['api'].setdefault('environment', {})['ACCESS_ISSUER'] = '${ACCESS_PUBLIC_URL:?Set the public Access origin}'
    config['services']['api']['env_file'] = [{'path': '${ACCESS_ENV_FILE:?Set the server environment file}', 'format': 'raw'}]
    config['services']['web']['ports'] = ['${ACCESS_BIND_ADDRESS:-127.0.0.1}:${ACCESS_HTTP_PORT:-8081}:3000']
    (output / 'compose.json').write_text(json.dumps(config, indent=2) + '\n')
    (output / 'access-deploy.py').write_bytes((root / 'scripts/access-deploy.py').read_bytes())
    manifest = {
        'schema': 1, 'tag': tag, 'registry': registry_host,
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'images': images,
        'migrations': {p.name: digest(p) for p in sorted((root / 'apps/api/src/database/migrations').glob('*.ts'))},
        'files': {name: digest(output / name) for name in ['compose.json', 'access-deploy.py']},
    }
    (output / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    validate(output, tag)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['create', 'validate'])
    parser.add_argument('tag')
    parser.add_argument('directory')
    args = parser.parse_args()
    if args.command == 'create':
        create(args.tag, args.directory)
    else:
        validate(args.directory, args.tag)
