import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deploy = load('access-deploy')
release = load('access-release')


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shared = self.root / 'shared'
        shared.mkdir()
        env = shared / 'production.env'
        env.write_text('NODE_ENV=production\n')
        env.chmod(0o600)
        key = shared / 'access-jwks-private.pem'
        key.write_text('synthetic-test-key')
        key.chmod(0o600)
        (shared / 'host.json').write_text(json.dumps({
            'bind_address': '127.0.0.1', 'http_port': 8081,
            'public_url': 'https://access.example.test', 'registry_host': 'registry.tail41610c.ts.net'}))
        self.commands = []

    def bundle(self, tag, migrations=None):
        directory = self.root / ('bundle-' + tag)
        directory.mkdir()
        images = {name: f'registry.tail41610c.ts.net/access/{name}@sha256:' + 'a' * 64
                  for name in ['api', 'web']}
        compose = {'services': {name: {'image': value} for name, value in images.items()}}
        (directory / 'compose.json').write_text(json.dumps(compose))
        (directory / 'access-deploy.py').write_bytes((ROOT / 'scripts/access-deploy.py').read_bytes())
        manifest = {'schema': 1, 'tag': tag, 'registry': 'registry.tail41610c.ts.net', 'commit': 'b' * 40, 'images': images,
                    'migrations': migrations or {},
                    'files': {name: release.digest(directory / name)
                              for name in ['compose.json', 'access-deploy.py']}}
        (directory / 'release.json').write_text(json.dumps(manifest))
        return directory

    def command(self, args, **kwargs):
        self.commands.append(args)
        return subprocess.CompletedProcess(args, 0, '')

    def response(self, request, **kwargs):
        import io
        self.assertEqual(request.get_header('User-agent'), 'Hemia-Access-Deploy/1.0')
        self.assertEqual(request.get_header('Accept'), 'application/json')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(kwargs['timeout'], 15)
        url = request.full_url
        body = {'status': 'ok'} if url.endswith('ready') else {'keys': [{'kid': 'test'}]}
        return io.BytesIO(json.dumps(body).encode())

    def perform(self, bundle, operation='deploy', **kwargs):
        with patch.object(deploy.subprocess, 'run', side_effect=self.command), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=self.response):
            deploy.perform(self.root, bundle, operation, **kwargs)

    def test_success_records_current_and_never_runs_migrations(self):
        bundle = self.bundle('access-v1.0.0')
        self.perform(bundle)
        self.assertEqual((self.root / 'current').resolve().name, 'access-v1.0.0')
        self.assertFalse(any('migration:run' in c for c in self.commands))
        self.assertTrue(any('showMigrations' in ' '.join(c) for c in self.commands))

    def test_asset_tampering_fails_before_docker(self):
        bundle = self.bundle('access-v1.0.0')
        (bundle / 'compose.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_missing_or_public_signing_key_fails_before_docker(self):
        bundle = self.bundle('access-v1.0.0')
        key = self.root / 'shared/access-jwks-private.pem'
        key.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'access-jwks-private.pem'):
            self.perform(bundle)
        key.unlink()
        with self.assertRaisesRegex(ValueError, 'access-jwks-private.pem'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_rollback_requires_schema_ack_and_never_reverts(self):
        self.perform(self.bundle('access-v1.1.0', {'new.ts': 'c' * 64}))
        old = self.bundle('access-v1.0.0')
        with self.assertRaisesRegex(ValueError, 'Migration sets differ'):
            self.perform(old, 'rollback')
        self.perform(old, 'rollback', acknowledge_schema=True)
        self.assertEqual((self.root / 'current').resolve().name, 'access-v1.0.0')
        self.assertEqual((self.root / 'previous').resolve().name, 'access-v1.1.0')
        self.assertFalse(any('migration:revert' in c for c in self.commands))

    def test_migration_requires_backup_and_does_not_promote(self):
        bundle = self.bundle('access-v1.0.0')
        with self.assertRaisesRegex(ValueError, 'backup'):
            self.perform(bundle, 'migrate')
        self.perform(bundle, 'migrate', backup_confirmed=True)
        self.assertFalse((self.root / 'current').exists())
        self.assertTrue(any('migration:run' in c for c in self.commands))

    def test_failed_health_recovers_prior_images_and_keeps_pointer(self):
        self.perform(self.bundle('access-v1.0.0'))
        candidate = self.bundle('access-v1.0.1')
        original = self.command

        def fail_candidate(args, **kwargs):
            if '/access-v1.0.1/compose.json' in ' '.join(args) and 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return original(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail_candidate), \
             patch.object(deploy.urllib.request, 'urlopen', side_effect=self.response):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertEqual((self.root / 'current').resolve().name, 'access-v1.0.0')
        self.assertIn('"recovered"', (self.root / 'history.jsonl').read_text())

    def test_failed_health_does_not_recover_across_schema_change(self):
        self.perform(self.bundle('access-v1.0.0'))
        candidate = self.bundle('access-v1.1.0', {'new.ts': 'c' * 64})
        self.commands.clear()

        def fail(args, **kwargs):
            if 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return self.command(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertFalse(any('/access-v1.0.0/compose.json' in ' '.join(c) for c in self.commands))

    def test_pending_migrations_do_not_replace_current(self):
        self.perform(self.bundle('access-v1.0.0'))
        candidate = self.bundle('access-v1.0.1')
        self.commands.clear()

        def fail_preflight(args, **kwargs):
            if 'showMigrations' in ' '.join(args):
                raise subprocess.CalledProcessError(1, args)
            return self.command(args, **kwargs)

        with patch.object(deploy.subprocess, 'run', side_effect=fail_preflight):
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.perform(self.root, candidate, 'deploy')
        self.assertFalse(any('up' in c for c in self.commands))
        self.assertEqual((self.root / 'current').resolve().name, 'access-v1.0.0')

    def test_release_creation_pins_private_registry_digests(self):
        output = self.root / 'created'
        config = {'services': {name: {'image': 'local', 'build': {'context': '.'}, 'volumes': [{'source': 'synthetic'}]}
                               for name in ['api', 'web']}}
        def command(args, **kwargs):
            if args[:2] == ['git', 'rev-parse']:
                return 'b' * 40
            if args[:2] == ['docker', 'compose']:
                return json.dumps(config)
            if args[:3] == ['docker', 'image', 'inspect']:
                image = args[3].split(':access-v', 1)[0]
                return json.dumps([{'RepoDigests': [image + '@sha256:' + 'a' * 64]}])
            raise AssertionError(args)
        with patch.object(release.subprocess, 'check_output', side_effect=command), \
             patch.dict(os.environ, {'REGISTRY_HOST': 'registry.tail41610c.ts.net'}):
            release.create('access-v1.0.0', output)
        manifest = release.validate(output)
        self.assertEqual(manifest['registry'], 'registry.tail41610c.ts.net')
        self.assertEqual(manifest['images']['api'],
            'registry.tail41610c.ts.net/access/api@sha256:' + 'a' * 64)
        compose = json.loads((output / 'compose.json').read_text())
        self.assertEqual(compose['services']['api']['volumes'][0]['source'],
            '${ACCESS_JWKS_PRIVATE_KEY_FILE:?Set the persistent signing key}')
        self.assertEqual(compose['services']['api']['environment']['ACCESS_ISSUER'],
            '${ACCESS_PUBLIC_URL:?Set the public Access origin}')
        self.assertNotIn('build', compose['services']['api'])
        self.assertNotIn('build', compose['services']['web'])
        deploy.read_manifest(output)

    def test_untrusted_registry_is_rejected_before_docker(self):
        bundle = self.bundle('access-v1.0.0')
        manifest = json.loads((bundle / 'release.json').read_text())
        manifest['registry'] = 'attacker.example.test'
        (bundle / 'release.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'unexpected registry'):
            release.validate(bundle)
        with self.assertRaisesRegex(ValueError, 'unexpected registry'):
            self.perform(bundle)
        self.assertEqual(self.commands, [])

    def test_registry_host_can_follow_a_vps_migration(self):
        bundle = self.bundle('access-v1.0.0')
        manifest = json.loads((bundle / 'release.json').read_text())
        compose = json.loads((bundle / 'compose.json').read_text())
        host = 'registry.example.test'
        manifest['registry'] = host
        for service in ['api', 'web']:
            image = host + '/access/' + service + '@sha256:' + 'a' * 64
            manifest['images'][service] = image
            compose['services'][service]['image'] = image
        (bundle / 'compose.json').write_text(json.dumps(compose))
        manifest['files']['compose.json'] = release.digest(bundle / 'compose.json')
        (bundle / 'release.json').write_text(json.dumps(manifest))
        settings = self.root / 'shared/host.json'
        data = json.loads(settings.read_text()); data['registry_host'] = host
        settings.write_text(json.dumps(data))
        release.validate(bundle, registry_host=host)
        self.perform(bundle)
        self.assertTrue((self.root / 'current').exists())

    def test_release_validation_rejects_mutable_image(self):
        bundle = self.bundle('access-v1.0.0')
        manifest = release.validate(bundle, 'access-v1.0.0')
        manifest['images']['api'] = 'ghcr.io/hemia-labs/access-api:latest'
        (bundle / 'release.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'digest'):
            release.validate(bundle)


if __name__ == '__main__':
    unittest.main()
