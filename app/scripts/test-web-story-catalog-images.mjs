import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStoryAssets} from '../web-story-assets.js';

test('catalog images alone accept clear landscape ratios; default, logo and URL guards remain strict',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vc-story-catalog-'));await fs.mkdir(path.join(root,'assets'));
  t.after(async()=>{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('vc-story-catalog-'));await fs.rm(target,{recursive:true,force:true});});
  const assets=createStoryAssets({publicDir:root,dataDir:root,siteUrl:'https://vitrinecity.test'});
  // Header fixtures isolate the existing raster-size gate; no fixture is published or decoded.
  async function picture(name,width,height){const header=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(header);header.writeUInt32BE(width,16);header.writeUInt32BE(height,20);await fs.writeFile(path.join(root,'assets',name+'.png'),header);return '/assets/'+name+'.png';}
  const wide=await picture('landscape',1024,512),minimum=await picture('minimum',640,360);
  assert.equal((await assets.image(wide,{catalog:true})).height,512);assert.equal((await assets.image(minimum,{catalog:true})).width,640);
  await assert.rejects(assets.image(wide),/640 pixels em cada lado/);await assert.rejects(assets.image(wide,{catalog:'true'}),/640 pixels em cada lado/);await assert.rejects(assets.image(wide,{catalog:true,logo:true}),/quadrado/);
  for(const [w,h] of [[639,1000],[1000,359],[10001,360],[10000,5000]])await assert.rejects(assets.image(await picture('invalid-'+w+'-'+h,w,h),{catalog:true}));
  for(const url of ['https://other.test/assets/landscape.png','//other.test/a.png','/assets/../landscape.png','/assets/%2e%2e/landscape.png','/assets/landscape.png?x=1'])await assert.rejects(assets.image(url,{catalog:true}));
});
