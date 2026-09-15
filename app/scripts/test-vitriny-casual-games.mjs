import test from 'node:test';
import assert from 'node:assert/strict';
import {newBlocks,validBlocks,blocksStatus,cellsFor,fits,rotateBlock,placeBlock,canPlace} from '../public/vitriny-blocks-core.js';
import {newMerge,validMerge,mergeStatus,mergeLine,moveMerge} from '../public/vitriny-merge-core.js';
import {readGame,writeGame} from '../public/vitriny-casual-storage.js';
const single={shape:0,rotation:0,color:1};
function blankBlocks(){return {...newBlocks(42),tray:[single,{shape:2,rotation:0,color:2},{shape:4,rotation:0,color:3}]};}
test('blocos: criação reproduzível e independente',()=>{
  const a=newBlocks(47),b=newBlocks(47);assert.deepEqual(a,b);assert.ok(validBlocks(a));assert.equal(blocksStatus(a),'playing');a.board[0]=3;assert.equal(b.board[0],0);
});
test('blocos: bordas, casas ocupadas e ações inválidas não consomem peças',()=>{
  const state=blankBlocks();assert.equal(fits(state.board,state.tray[1],0,4),false);assert.equal(fits(state.board,single,-1,0),false);assert.equal(fits(state.board,single,0.5,0),false);
  assert.equal(placeBlock(state,1,0,5).state,state);assert.equal(placeBlock(state,9,0,0).state,state);
  const next=placeBlock(state,0,0,0).state;assert.equal(fits(next.board,single,0,0),false);assert.equal(state.board[0],0);
});
test('blocos: limpar linha e coluna simultâneas remove cruzamento uma só vez',()=>{
  const s=blankBlocks();for(let i=1;i<6;i++){s.board[i]=1;s.board[i*6]=2;}
  const r=placeBlock(s,0,0,0);assert.equal(r.lines,2);assert.equal(r.cleared.length,11);assert.equal(new Set(r.cleared).size,11);assert.equal(r.state.score,165);assert.equal(r.state.board.filter(Boolean).length,0);assert.equal(r.state.tray[0],null);
});
test('blocos: combo cresce somente com limpezas consecutivas',()=>{
  const s=blankBlocks();s.combo=2;for(let i=1;i<6;i++)s.board[i]=1;
  const r=placeBlock(s,0,0,0);assert.equal(r.state.combo,3);assert.equal(r.gained,185);
  assert.equal(placeBlock(r.state,1,3,0).state.combo,0);
});
test('blocos: giro normalizado, bandeja nova e fim consideram todas rotações',()=>{
  const s=blankBlocks();const original=cellsFor(s.tray[1]);let rotated=s;for(let i=0;i<4;i++)rotated=rotateBlock(rotated,1);assert.deepEqual(cellsFor(rotated.tray[1]),original);
  s.tray=[null,s.tray[1],null];s.board.fill(1);[0,6,12].forEach(i=>s.board[i]=0);assert.equal(fits(s.board,s.tray[1],0,0),false);assert.equal(canPlace(s.board,s.tray[1]),true);assert.equal(blocksStatus(s),'playing');
  s.board[12]=1;assert.equal(blocksStatus(s),'over');
  const last={...blankBlocks(),tray:[single,null,null]};const next=placeBlock(last,0,0,0).state;assert.equal(next.tray.filter(Boolean).length,3);assert.ok(next.tray.some(p=>canPlace(next.board,p)));
});
test('blocos: meta para em 12 linhas e continuar preserva a partida',()=>{
  const s={...blankBlocks(),lines:12};assert.equal(blocksStatus(s),'won');assert.equal(placeBlock(s,0,0,0).state,s);assert.equal(blocksStatus({...s,continued:true}),'playing');
});
test('jardim: cada peça combina apenas uma vez na jogada',()=>{
  assert.deepEqual(mergeLine([1,1,1,1]),{line:[2,2,0,0],gained:8});assert.deepEqual(mergeLine([1,1,2,0]),{line:[2,2,0,0],gained:4});assert.deepEqual(mergeLine([0,2,0,2]),{line:[3,0,0,0],gained:8});
});
test('jardim: todas as direções juntam do lado correto',()=>{
  for(const direction of ['up','down','left','right']){
    const s={...newMerge(14),board:Array(16).fill(0)};
    const vertical=['up','down'].includes(direction);s.board[0]=1;s.board[vertical?4:1]=1;
    const r=moveMerge(s,direction);const target={up:0,left:0,down:12,right:3}[direction];assert.equal(r.state.board[target],2);assert.equal(r.gained,4);assert.equal(r.state.board.filter(Boolean).length,2);assert.equal(r.state.moves,1);assert.equal(s.board[0],1);
  }
});
test('jardim: movimento sem efeito não gera planta nem muda a semente',()=>{
  const s={...newMerge(8),board:[1,2,3,0,...Array(12).fill(0)]};assert.equal(moveMerge(s,'left').state,s);assert.equal(moveMerge(s,'invalid').state,s);
});
test('jardim: vitória, continuar e falta de jogadas são estados distintos',()=>{
  const s={...newMerge(1),board:[7,7,...Array(14).fill(0)]};const won=moveMerge(s,'left').state;assert.equal(mergeStatus(won),'won');assert.equal(won.score,256);assert.equal(moveMerge(won,'right').state,won);assert.equal(mergeStatus({...won,continued:true}),'playing');
  const full={...newMerge(1),board:[1,2,1,2,2,1,2,1,1,2,1,2,2,1,2,1]};assert.equal(mergeStatus(full),'over');full.board[0]=2;assert.equal(mergeStatus(full),'playing');
});
test('jardim: partidas longas conservam valor, exceto a nova planta',()=>{
  let s=newMerge(624);let count=0;
  for(let i=0;i<600;i++){
    const before=s.board.reduce((a,v)=>a+(v?2**v:0),0);const r=moveMerge({...s,continued:true},['left','down','right','up'][i%4]);
    if(r.state.moves>s.moves){const delta=r.state.board.reduce((a,v)=>a+(v?2**v:0),0)-before;assert.ok(delta===2||delta===4);count++;}
    s=r.state;assert.ok(validMerge(s));if(mergeStatus(s)==='over')break;
  }assert.ok(count>10);
});
test('persistência: corrupção, schema inválido e storage bloqueado não quebram jogo',()=>{
  const data=new Map(),store={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.equal(writeGame(store,'test',newBlocks(1),10),true);assert.ok(readGame(store,'test',validBlocks));
  for(const raw of ['{','null',JSON.stringify({version:1,state:{...newBlocks(),board:[0]},best:0}),JSON.stringify({version:1,state:newBlocks(),best:-1}),'x'.repeat(13000)]){data.set('test',raw);assert.equal(readGame(store,'test',validBlocks),null);}
  const blocked={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};assert.equal(readGame(blocked,'x',validBlocks),null);assert.equal(writeGame(blocked,'x',newMerge(),0),false);
  assert.equal(validMerge({...newMerge(),board:Array(16).fill(0)}),false);assert.equal(validBlocks({...newBlocks(),tray:[null,null,null]}),false);
});
