"""Exercise the production deployment gate without contacting GitHub or apps."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AutoDeployTest(unittest.TestCase):
    def run_gate(self, enabled, automatic='true'):
        workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
        gate = workflow.split('\n  enabled:\n', 1)[1].split('\n  deploy:\n', 1)[0]
        self.assertIn('environment: prod', gate)
        self.assertIn('ENABLE_DEPLOY: ${{ vars.ENABLE_ACCESS_DEPLOY }}', gate)
        script = textwrap.dedent(re.search(r'        run: \|\n((?:          .*\n|\n)+)', gate)[1])
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            summary = Path(directory) / 'summary'
            result = subprocess.run(['bash', '-euo', 'pipefail', '-c', script], env={**os.environ,
                'AUTOMATIC': automatic, 'ENABLE_DEPLOY': enabled,
                'GITHUB_OUTPUT': str(output), 'GITHUB_STEP_SUMMARY': str(summary)},
                text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return output.read_text().strip(), summary.read_text() if summary.exists() else ''

    def test_release_reuses_deployment_after_successful_publication(self):
        workflow = (ROOT / '.github/workflows/access-release.yml').read_text()
        job = workflow.split('\n  auto-deploy:\n', 1)[1]
        self.assertIn('needs: publish', job)
        self.assertIn("!cancelled() && needs.publish.result == 'success'", job)
        self.assertIn('uses: ./.github/workflows/deploy.yml', job)
        self.assertIn('release_tag: ${{ needs.publish.outputs.release_tag }}', job)
        self.assertIn('automatic: true', job)
        self.assertNotIn('gh workflow run', job)
        deploy = (ROOT / '.github/workflows/deploy.yml').read_text()
        self.assertIn('workflow_dispatch:', deploy)
        self.assertIn('options: [deploy, rollback, migrate]', deploy)
        self.assertIn("if: needs.enabled.outputs.deploy == 'true'", deploy)

    def test_automatic_deployment_requires_exact_true(self):
        for enabled, expected in [('true', 'true'), ('', 'false'), ('false', 'false'), ('TRUE', 'false')]:
            with self.subTest(enabled=enabled):
                output, summary = self.run_gate(enabled)
                self.assertEqual(output, 'deploy=' + expected)
                if expected == 'false':
                    self.assertIn('disabled in prod', summary)

    def test_manual_operations_reach_existing_configuration_validation(self):
        for enabled in ['true', 'false', '']:
            with self.subTest(enabled=enabled):
                output, _ = self.run_gate(enabled, automatic='false')
                self.assertEqual(output, 'deploy=true')


if __name__ == '__main__':
    unittest.main()
