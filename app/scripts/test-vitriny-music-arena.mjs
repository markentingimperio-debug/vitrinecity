import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberPage} from '../public/vitriny-membership-core.js';
const source=readFileSync(new URL('../public/vitriny-music-arena.js',import.meta.url),'utf8');
assert.equal(memberPage('/vitriny-music-arena.html'),true);assert.match(source,/autoplay=0/);assert.match(source,/youtube-nocookie\.com\/embed\/98ovJs-Ibd4/);assert.match(source,/open\.spotify\.com\/embed\/playlist\/3d7eXh3ohl1YeaKHVCKNsU/);assert.match(source,/closePlayer\(\);const frame/);assert.match(source,/addEventListener\('pagehide',closePlayer\)/);assert.doesNotMatch(source,/fetch\(|playVideo\(|\.play\(/);
console.log('music-arena: gated page, supplied media, official embeds, explicit loading, one player and teardown passed');
