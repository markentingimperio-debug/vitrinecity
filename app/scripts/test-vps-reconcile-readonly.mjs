import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const script=readFileSync(`${root}/ops/reconcile-vps-readonly.sh`,'utf8');

assert.match(script,/^#!\/usr\/bin\/env bash/m);
assert.match(script,/set -euo pipefail/);
assert.match(script,/repo_dir="\$\{1:-\/opt\/vitrinecity\}"/);
assert.match(script,/git rev-parse HEAD/);
assert.match(script,/git diff --name-only/);
assert.match(script,/git ls-files --others --exclude-standard/);
assert.match(script,/docker compose ps/);
assert.match(script,/docker compose images/);
assert.match(script,/127\.0\.0\.1:3000\/api\/health/);
assert.match(script,/127\.0\.0\.1:3000\/api\/spatial\/v1/);
assert.match(script,/\[redacted-sensitive-path\]/);

for(const forbidden of [
  /\bgit\s+reset\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+checkout\b/,
  /\bdocker\s+compose\s+(?:down|restart|up)\b/,
  /\bdocker\s+(?:rm|rmi|system\s+prune)\b/,
  /\brm\s+-rf\b/,
  /\bcat\s+[^\n]*\.env\b/,
  /\bsqlite3\b/,
]) assert.equal(forbidden.test(script.replace(/^#.*$/gm,'')),false,String(forbidden));

console.log(JSON.stringify({ok:true,readOnly:true,secretContents:false,healthProbes:true}));
