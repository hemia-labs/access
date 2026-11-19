import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('access_release_roles', ROOT / 'scripts/access-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseAuthorizationTests(unittest.TestCase):
    def test_release_overrides_obsolete_environment_with_roles(self):
        def command(args, **kwargs):
            if args[:2] == ['git', 'rev-parse']:
                return 'b' * 40
            if args[:2] == ['docker', 'compose']:
                return json.dumps({'services': {
                    'api': {'build': {}, 'volumes': [{'source': 'local-key'}],
                            'environment': {'HEMIA_AUTHORIZATION_MODE': 'authenticated',
                                            'HEMIA_BILLING_AUTHORIZATION_MODE': 'authenticated'}},
                    'web': {'build': {}}}})
            if args[:3] == ['docker', 'image', 'inspect']:
                image = args[3].split(':access-v', 1)[0]
                return json.dumps([{'RepoDigests': [image + '@sha256:' + 'a' * 64]}])
            raise AssertionError(args)

        with tempfile.TemporaryDirectory() as output, \
             patch.object(release.subprocess, 'check_output', side_effect=command), \
             patch.dict(os.environ, {'REGISTRY_HOST': release.DEFAULT_REGISTRY,
                                     'HEMIA_AUTHORIZATION_MODE': 'authenticated'}):
            release.create('access-v1.0.0', output)
            environment = json.loads((Path(output) / 'compose.json').read_text())['services']['api']['environment']
            self.assertEqual(environment['HEMIA_AUTHORIZATION_MODE'], 'roles')
            self.assertEqual(environment['HEMIA_BILLING_AUTHORIZATION_MODE'], 'roles')
