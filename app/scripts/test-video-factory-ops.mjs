import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = [
  new URL('../../ops/deploy-video-factory.sh', import.meta.url),
  new URL('../../ops/verify-video-factory.sh', import.meta.url)
];

const shell = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? 'bash' : 'sh';

for (const url of scripts) {
  test(`shell syntax: ${url.pathname.split('/').pop()}`, () => {
    const file = fileURLToPath(url);
    const result = spawnSync(shell, ['-n', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout || `${shell} -n failed`);
  });
}
