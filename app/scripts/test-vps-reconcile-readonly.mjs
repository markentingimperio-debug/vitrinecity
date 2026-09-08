import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const script=readFileSync(`${root}/ops/reconcile-vps-readonly.sh`,'utf8');
const executableScript=script.replace(/^#.*$/gm,'');

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
assert.match(script,/\*\.sqlite3/);

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
]) assert.equal(forbidden.test(executableScript),false,String(forbidden));

// Database filenames such as "*.sqlite3" are intentionally present in the
// redaction allowlist. Reject executable sqlite3 invocations without treating
// a filename suffix as a command.
for(const forbiddenSqliteInvocation of [
  /^\s*(?:(?:sudo|command)\s+)?sqlite3\b/m,
  /(?:[;&|]\s*|\$\(\s*|\b(?:if|then|do|while|until)\s+)(?:(?:sudo|command)\s+)?sqlite3\b/m,
]) assert.equal(forbiddenSqliteInvocation.test(executableScript),false,String(forbiddenSqliteInvocation));

console.log(JSON.stringify({ok:true,readOnly:true,secretContents:false,healthProbes:true}));
