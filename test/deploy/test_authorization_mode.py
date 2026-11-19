import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
CODE=next(n.value.value for n in ast.walk(ast.parse((ROOT/'scripts/access-remote.py').read_text())) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='configure_mode' for t in n.targets))
class RolesSettingTest(unittest.TestCase):
    def test_removes_temporary_mode_without_exposing_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'shared/production.env';path.parent.mkdir();path.write_text('SECRET=synthetic-private\nHEMIA_AUTHORIZATION_MODE=authenticated\nHEMIA_BILLING_AUTHORIZATION_MODE=authenticated\n');path.chmod(0o600)
            result=subprocess.run([sys.executable,'-c',CODE,temp,'roles'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('SECRET=synthetic-private\n',path.read_text())
            self.assertIn('HEMIA_AUTHORIZATION_MODE=roles\n',path.read_text())
            self.assertIn('HEMIA_BILLING_AUTHORIZATION_MODE=roles\n', path.read_text())
            self.assertNotIn('synthetic-private',result.stdout+result.stderr)
            before=path.read_text()
            denied=subprocess.run([sys.executable,'-c',CODE,temp,'authenticated'],capture_output=True,text=True)
            self.assertNotEqual(denied.returncode,0)
            self.assertEqual(path.read_text(),before)
