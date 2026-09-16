// Offline browser QA. Set PLAYWRIGHT_MODULE to a locally installed Playwright entry point.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {newBlocks} from '../public/vitriny-blocks-core.js';
import {newMerge} from '../public/vitriny-merge-core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../public/',import.meta.url));
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const filename=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!filename.startsWith(root)){res.writeHead(403);res.end();return;}
    const content=await readFile(filename);
    res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','svg':'image/svg+xml'})[filename.split('.').pop()]||'application/octet-stream');res.end(content);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CASUAL_QA_BROWSER?{executablePath:process.env.CASUAL_QA_BROWSER}:{})});
const errors=[],requests=[];let checks=0;
const context=await browser.newContext({viewport:{width:1440,height:1050},hasTouch:true});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){requests.push(url.origin);return route.abort();}return route.continue();});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const saveKey=kind=>`vc-games-${kind}-v1`;
async function seed(kind,state){await page.goto(`${origin}/vitriny-${kind}.html`);await page.evaluate(({key,state})=>localStorage.setItem(key,JSON.stringify({version:1,state,best:state.score})),{key:saveKey(kind),state});await page.reload();}
async function stored(kind){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),saveKey(kind));}
async function screenshot(name){if(process.env.CASUAL_QA_OUTPUT){await mkdir(process.env.CASUAL_QA_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.CASUAL_QA_OUTPUT,name+'.png'),fullPage:true});}}
try{
  const block={...newBlocks(22),tray:[{shape:0,rotation:0,color:1},{shape:2,rotation:0,color:2},{shape:4,rotation:0,color:3}]};
  await seed('blocks',block);
  await page.locator('[data-piece="0"]').tap();await page.locator('.block-cell').first().tap();
  assert.equal((await stored('blocks')).state.score,5);checks++;
  await page.locator('#undo').click();assert.deepEqual((await stored('blocks')).state,block);assert.equal((await stored('blocks')).best,5);checks++;
  await page.locator('.block-cell').first().focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.index),'1');await page.keyboard.press('Enter');assert.equal((await stored('blocks')).state.board[1],1);checks++;
  await page.locator('.block-cell[data-index="1"]').hover();
  assert.equal(await page.locator('.block-cell[data-index="1"]').evaluate(el=>el.classList.contains('invalid')),true);
  assert.equal(await page.locator('.block-cell[data-index="1"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(214, 237, 153)');checks++;
  await page.keyboard.press('2');await page.keyboard.press('r');assert.equal((await stored('blocks')).state.tray[1].rotation,1);checks++;
  await page.reload();assert.equal((await stored('blocks')).state.board[1],1);assert.match(await page.locator('#message').innerText(),/retomada/);checks++;
  await page.locator('#restart').click();assert.equal(await page.locator('#restart-dialog').evaluate(el=>el.open),true);await page.locator('#cancel-restart').click();assert.equal((await stored('blocks')).state.board[1],1);await page.locator('#restart').click();await page.locator('#confirm-restart').click();assert.equal((await stored('blocks')).state.score,0);checks++;
  const win={...block,lines:11};for(let i=1;i<6;i++)win.board[i]=2;await seed('blocks',win);await page.locator('.block-cell').first().click();assert.equal(await page.locator('#end').isVisible(),true);assert.match(await page.locator('#end-title').innerText(),/encaixe/);await page.locator('#continue').click();assert.equal(await page.locator('#end').isVisible(),false);checks++;
  const over={...block,board:Array(36).fill(2)};await seed('blocks',over);assert.equal(await page.locator('#end').isVisible(),true);assert.equal(await page.locator('#continue').isVisible(),false);await page.locator('#end-restart').click();await page.locator('#confirm-restart').click();assert.equal(await page.locator('#end').isVisible(),false);checks++;
  const merge={...newMerge(22),board:[1,1,0,0,...Array(12).fill(0)]};await seed('merge',merge);await page.locator('#board').focus();await page.keyboard.press('ArrowLeft');assert.equal((await stored('merge')).state.score,4);assert.equal((await stored('merge')).state.board[0],2);checks++;
  await page.locator('#undo').click();assert.deepEqual((await stored('merge')).state,merge);await page.locator('[data-direction="right"]').tap();assert.equal((await stored('merge')).state.board[3],2);checks++;
  await seed('merge',merge);const bounds=await page.locator('#board').boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width-40,y:bounds.y+80}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+45,y:bounds.y+80}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal((await stored('merge')).state.score,4);checks++;
  await seed('merge',{...merge,board:[7,7,...Array(14).fill(0)]});await page.locator('[data-direction="left"]').click();assert.match(await page.locator('#end-title').innerText(),/floresceu/);await page.locator('#continue').click();assert.equal((await stored('merge')).state.continued,true);checks++;
  const noMoves={...merge,board:[1,2,1,2,2,1,2,1,1,2,1,2,2,1,2,1]};await seed('merge',noMoves);assert.equal(await page.locator('#end').isVisible(),true);assert.equal(await page.locator('#continue').isVisible(),false);checks++;
  await page.locator('#end-restart').click();await page.locator('#confirm-restart').click();assert.equal((await stored('merge')).state.moves,0);checks++;
  await page.evaluate(()=>localStorage.setItem('vc-games-merge-v1','{corrupt'));await page.reload();assert.equal((await stored('merge')).state.board.filter(Boolean).length,2);checks++;
  const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('blocked storage')}}));const blockedPage=await blocked.newPage();blockedPage.on('pageerror',e=>errors.push(e.message));await blockedPage.goto(`${origin}/vitriny-merge.html`);await blockedPage.locator('[data-direction="right"]').click();assert.match(await blockedPage.locator('#storage-note').innerText(),/não permitiu salvar/);await blocked.close();checks++;
  // Representative, seeded mid-game states make layout and plant labels inspectable.
  const previewBlock={...block,board:[1,1,0,0,0,3,0,1,0,0,0,3,0,0,0,2,2,3,0,0,0,2,0,0,0,3,3,0,0,0,0,0,3,1,1,0],score:365,lines:4};
  const previewMerge={...merge,board:[1,2,0,0,3,5,2,0,1,4,6,0,2,3,7,0],score:428,moves:34};
  await seed('blocks',previewBlock);await seed('merge',previewMerge);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:width<700?844:1050});
    for(const game of ['games','blocks','merge']){
      await page.goto(`${origin}/vitriny-${game}.html`);
      const overflow=await page.evaluate(()=>({body:document.body.scrollWidth,view:document.documentElement.clientWidth}));assert.ok(overflow.body<=overflow.view,`${game} overflow at ${width}: ${JSON.stringify(overflow)}`);
      if(game!=='games'){const rect=await page.locator('#board').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);assert.ok(rect.height>200);}
      if(width===390||width===1440)await screenshot(`${game}-${width}`);checks++;
    }
  }
  await page.goto(`${origin}/vitriny-games.html`);assert.equal(await page.locator('a[href="/vitriny-blocks.html"]').count(),1);assert.equal(await page.locator('a[href="/vitriny-merge.html"]').count(),1);assert.equal(await page.locator('a[href="/vitriny-mini-fazenda.html"]').count(),1);checks++;
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(`${checks} verificações de navegador aprovadas; zero erros JS ou chamadas externas. Capturas: ${process.env.CASUAL_QA_OUTPUT||'desativadas'}`);
}finally{await browser.close();server.close();}
