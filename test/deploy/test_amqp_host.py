"""Verify the deployment hostname override never rewrites credentials or other services."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REMOTE = ROOT / 'scripts' / 'access-remote.py'
CODE = next(node.value.value for node in ast.walk(ast.parse(REMOTE.read_text()))
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'configure_amqp' for target in node.targets))


class AmqpHostTests(unittest.TestCase):
    def run_override(self, content, host='185.187.235.117', mode=0o600):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'shared/production.env'
            path.parent.mkdir()
            path.write_text(content)
            path.chmod(mode)
            result = subprocess.run([sys.executable, '-c', CODE, temp, host], capture_output=True, text=True)
            return result, path.read_text(), list(path.parent.glob('production.env.before-amqp-*')) != []

    def test_credentials_port_vhost_and_other_connections_are_preserved(self):
        for quote in ['', '"', "'"]:
            with self.subTest(quote=quote):
                original_url = 'amqp://user:p%40ss217.196.48.81@217.196.48.81:5673/%2Ftenant?heartbeat=60'
                original = 'DB_HOST=192.168.100.103\nAMQP_URL=' + quote + original_url + quote + '\nJWT_SECRET=dummy-unchanged\n'
                result, output, backup = self.run_override(original)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output, original.replace('@217.196.48.81:', '@185.187.235.117:'))
                self.assertTrue(backup)
                self.assertNotIn(original_url, result.stdout + result.stderr)

    def test_malformed_url_does_not_expose_credential_in_parser_error(self):
        original = 'AMQP_URL=amqp://user:sensitive-private-value\n'
        result, output, backup = self.run_override(original)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(output, original)
        self.assertNotIn('sensitive-private-value', result.stdout + result.stderr)
        self.assertFalse(backup)

    def test_already_configured_is_idempotent(self):
        original = 'AMQP_URL=amqp://user:dummy@185.187.235.117:5672/\n'
        result, output, backup = self.run_override(original)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, original)
        self.assertFalse(backup)

    def test_invalid_input_or_permissions_leave_file_unchanged(self):
        valid = 'AMQP_URL=amqp://user:dummy@217.196.48.81:5672/\n'
        for content, host, mode in [(valid, 'bad;host', 0o600), (valid, '185.187.235.117', 0o644), ('DB_HOST=192.168.100.103\n', '185.187.235.117', 0o600), (valid + valid, '185.187.235.117', 0o600), ('AMQP_URL=https://217.196.48.81/\n', '185.187.235.117', 0o600)]:
            with self.subTest(host=host, mode=mode):
                result, output, backup = self.run_override(content, host, mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, content)
                self.assertFalse(backup)


if __name__ == '__main__':
    unittest.main()
