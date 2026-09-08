import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

// Resolve the transitive copy used by Express, including nested installations.
// Tiny, synchronous fixtures only: no HTTP, database, subprocess or large payload.
const appRequire=createRequire(import.meta.url);
const expressRequire=createRequire(appRequire.resolve('express'));
const qs=expressRequire('qs');
const version=expressRequire('qs/package.json').version;
const failures=[];
function scenario(name,run){
  try{run();console.log('PASS '+name);}
  catch(error){failures.push(name);console.error('FAIL '+name+' (qs '+version+'): '+error.message);}
}

// Official advisory: patched in 6.16.0.
// https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx
const arrayOptions={comma:true,arrayLimit:3,throwOnLimitExceeded:true};
scenario('comma parsing respects the limit for a plain key',()=>{
  assert.throws(()=>qs.parse('a=1,2,3,4',arrayOptions),RangeError);
});
scenario('bracket-key comma parsing cannot bypass the array limit',()=>{
  assert.throws(()=>qs.parse('a[]=1,2,3,4',arrayOptions),RangeError);
});
scenario('percent-encoded brackets cannot bypass the comma array limit',()=>{
  assert.throws(()=>qs.parse('a%5B%5D=1,2,3,4',arrayOptions),RangeError);
});
scenario('ordinary comma values within the configured limit remain usable',()=>{
  assert.deepEqual(qs.parse('a=1,2,3',arrayOptions),{a:['1','2','3']});
});

// Official advisory: patched in 6.16.0. The hostile shape is produced by parse,
// not executable input; keep it at one nested key and a one-character value.
// https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g
const untrustedQuery='x%5Bconstructor%5D%5BisBuffer%5D=y';
for(const options of [{plainObjects:true},{allowPrototypes:true}]){
  const label=Object.keys(options)[0];
  scenario('parse/stringify with '+label+' handles a non-callable isBuffer',()=>{
    const parsed=qs.parse(untrustedQuery,options);
    assert.equal(Object.hasOwn(parsed.x,'constructor'),true,'The fixture must exercise the affected own-property shape.');
    assert.equal(parsed.x.constructor.isBuffer,'y');
    let serialized;
    assert.doesNotThrow(()=>{serialized=qs.stringify(parsed);});
    assert.equal(serialized,untrustedQuery);
    assert.equal(Object.prototype.isBuffer,undefined,'Parsing must not pollute Object.prototype.');
  });
}
scenario('stringifying bounded JSON data never calls a non-function isBuffer',()=>{
  for(const value of ['x',1,true,{},[]]){
    const parsed=JSON.parse(JSON.stringify({x:{constructor:{isBuffer:value}}}));
    assert.doesNotThrow(()=>qs.stringify(parsed));
  }
});
scenario('real buffers and ordinary nested query data retain their behavior',()=>{
  assert.equal(qs.stringify({bytes:Buffer.from('abc')}),'bytes=abc');
  const value={filter:{category:'plantas'},page:'2'};
  assert.deepEqual(qs.parse(qs.stringify(value)),value);
});

assert.deepEqual(failures,[],'The qs instance resolved from Express must pass both security regressions.');
console.log('qs '+version+': bounded array-limit and isBuffer security regressions passed.');
