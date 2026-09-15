import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {cityArrivalPose,cityWalkingPose} from '../public/vitriny-city-arrival.js';

test('fresh arrival faces the boulevard at a human-readable elevated street height', () => {
  for (const mobile of [false, true]) {
    const pose = cityArrivalPose({mobile});
    assert.equal(pose.x, -164);
    assert.ok(pose.z > 220 && pose.z < 252);
    assert.ok(pose.y > 6 && pose.y < 10);
    assert.ok(pose.pitch >= 0 && pose.pitch < .08);
    assert.equal(pose.yaw, Math.PI);
    assert.ok(Object.values(pose).every(Number.isFinite));
  }
});
test('panorama and preview cities preserve their former overview', () => {
  assert.deepEqual(cityArrivalPose({panoramic:true}), {x:-164,y:27,z:235,yaw:Math.PI,pitch:-.16});
  assert.deepEqual(cityArrivalPose({active:false}), {x:0,y:38,z:132,yaw:Math.PI,pitch:.14});
});
test('walking mode is at pedestrian height, not the elevated arrival camera', () => {
  assert.deepEqual(cityWalkingPose(), {x:-164,y:2.2,z:145,yaw:Math.PI,pitch:.035});
  assert.deepEqual(cityWalkingPose({active:false}), {x:23,y:2.2,z:53,yaw:Math.PI-.4,pitch:.035});
  const pose=cityWalkingPose();pose.y=100;
  assert.equal(cityWalkingPose().y,2.2);
  const source=readFileSync(new URL('../public/vitriny-multiverse-explore.js',import.meta.url),'utf8');
  assert.match(source,/position\.y>10\?cityWalkingPose\(\{active:isActiveCity\}\)/);
});
test('presets are independent values and do not overwrite saved visitor checkpoints', () => {
  const pose=cityArrivalPose();pose.x=900;
  assert.equal(cityArrivalPose().x,-164);
  const source=readFileSync(new URL('../public/vitriny-multiverse-explore.js',import.meta.url),'utf8');
  assert.ok(source.indexOf('restoreSpatialContext();')>source.indexOf('const arrival=cityArrivalPose('));
  assert.match(source,/position\.set\(state\.position\.x,state\.position\.y,state\.position\.z\);yaw=state\.yaw;pitch=state\.pitch/);
  assert.match(source,/get\('return'\)!=='1'/);
});
