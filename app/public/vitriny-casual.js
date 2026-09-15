import {readGame,writeGame} from './vitriny-casual-storage.js';
import {newBlocks,validBlocks,blocksStatus,cellsFor,fits,rotateBlock,placeBlock} from './vitriny-blocks-core.js';
import {newMerge,validMerge,mergeStatus,moveMerge,plantName} from './vitriny-merge-core.js';

const blocks=document.body.dataset.game==='blocks';
const $=id=>document.getElementById(id);
const board=$('board'), statusOf=blocks?blocksStatus:mergeStatus, create=blocks?newBlocks:newMerge;
const key=blocks?'vc-games-blocks-v1':'vc-games-merge-v1';
let storage;try{storage=window.localStorage;}catch{}
const saved=readGame(storage,key,blocks?validBlocks:validMerge);
let state=saved?.state || create(), best=Math.max(saved?.best||0,state.score), previous=null;
let selected=blocks?state.tray.findIndex(Boolean):0, previousSelected=selected;
let pointer=null;
const format=n=>n.toLocaleString('pt-BR');
function announce(text){$('message').textContent=text;}
function persist(){if(!writeGame(storage,key,state,best)) $('storage-note').textContent='O navegador não permitiu salvar. Você pode continuar jogando nesta página.';}
function plantSvg(level){
  const seed='<ellipse cx="32" cy="41" rx="10" ry="14" transform="rotate(30 32 41)" fill="currentColor"/>';
  const stem='<path d="M32 55V24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M31 43C14 44 9 31 12 26C26 25 33 32 31 43ZM33 35C34 20 45 15 53 19C54 31 44 38 33 35Z" fill="currentColor"/>';
  const flower='<g fill="currentColor"><circle cx="32" cy="17" r="9"/><circle cx="22" cy="24" r="9"/><circle cx="42" cy="24" r="9"/><circle cx="26" cy="35" r="9"/><circle cx="38" cy="35" r="9"/></g><circle cx="32" cy="27" r="6" fill="#f8e5a5"/>';
  const tree='<path d="M31 57V24" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M14 40C2 20 17 12 24 16C24 1 44 2 46 16C62 17 63 40 48 45C35 51 24 47 14 40Z" fill="currentColor"/><path d="M32 53V29m0 11-9-8m9 2 9-9" stroke="#f8f5eb" stroke-width="2" fill="none"/>';
  const bud='<path d="M32 56V28" stroke="currentColor" stroke-width="4"/><path d="M31 43C16 43 12 33 16 29C29 30 35 37 31 43Z" fill="currentColor"/><ellipse cx="32" cy="22" rx="9" ry="13" fill="#b25747"/>';
  const art=level===1?seed:level===2?stem:level===3?stem+'<path d="M32 52C16 57 9 46 10 42C23 38 30 44 32 52Z" fill="currentColor"/>':level===4?bud:level===5?stem+flower:level===6?`<g transform="translate(1 12) scale(.72)">${stem+flower}</g><g transform="translate(22 3) scale(.68)">${stem+flower}</g>`:level===7?tree:`<g transform="translate(-3 18) scale(.67)">${tree}</g><g transform="translate(25 16) scale(.67)">${tree}</g><g transform="translate(12 -4) scale(.68)">${tree}</g>`;
  return `<svg viewBox="0 0 64 64" class="plant-art" aria-hidden="true">${art}</svg>`;
}
function render(){
  const active=document.activeElement, focusedCell=board.contains(active)?active.dataset.index:null;
  const focusedPiece=active?.dataset.piece;
  const status=statusOf(state);
  best=Math.max(best,state.score);
  $('score').textContent=format(state.score);$('best').textContent=format(best);
  const progress=blocks?state.lines:Math.max(...state.board), target=blocks?12:8;
  $('progress').textContent=`${progress} / ${target}`;
  $('goal-track').replaceChildren(...Array.from({length:target},(_,i)=>{const e=document.createElement('i');e.classList.toggle('done',i<progress);return e;}));
  board.replaceChildren(...state.board.map((value,i)=>{
    const cell=document.createElement(blocks?'button':'div');cell.dataset.index=String(i);
    if(blocks){cell.type='button';cell.className='block-cell';cell.dataset.color=String(value);cell.tabIndex=i===Number(focusedCell||0)?0:-1;
      cell.setAttribute('aria-label',`Linha ${Math.floor(i/6)+1}, coluna ${i%6+1}: ${value?'ocupada':'vazia'}`);
      cell.setAttribute('aria-disabled',String(status!=='playing'));
    }else{cell.className=`merge-cell${value?' filled':''}`;cell.dataset.level=String(value);cell.setAttribute('role','img');cell.setAttribute('aria-label',`Linha ${Math.floor(i/4)+1}, coluna ${i%4+1}: ${value?`${plantName(value)}, nível ${value}`:'vazia'}`);
      if(value){cell.innerHTML=plantSvg(value);const number=document.createElement('span');number.className='plant-level';number.textContent=String(value);const label=document.createElement('span');label.className='plant-name';label.textContent=plantName(value);cell.append(number,label);}}
    return cell;
  }));
  if(blocks){
    if(!state.tray[selected]) selected=state.tray.findIndex(Boolean);
    $('tray').replaceChildren(...state.tray.map((piece,i)=>{
      const button=document.createElement('button');button.type='button';button.className='piece';button.dataset.piece=String(i);button.disabled=!piece || status!=='playing';button.setAttribute('aria-pressed',String(i===selected&&!!piece));
      const label=document.createElement('span');label.textContent=piece?`Peça ${i+1}`:'Já usada';
      if(piece){const cells=cellsFor(piece),preview=document.createElement('div'),stage=document.createElement('div');stage.className='piece-stage';stage.setAttribute('aria-hidden','true');preview.className='piece-grid';preview.style.gridTemplateColumns=`repeat(${Math.max(...cells.map(c=>c[1]))+1},14px)`;preview.style.gridTemplateRows=`repeat(${Math.max(...cells.map(c=>c[0]))+1},14px)`;
        for(const [r,c] of cells){const dot=document.createElement('i');dot.className='piece-dot';dot.dataset.color=String(piece.color);dot.style.gridRow=String(r+1);dot.style.gridColumn=String(c+1);preview.append(dot);}stage.append(preview);button.append(stage);
        button.setAttribute('aria-label',`Peça ${i+1}, ${cells.length} quadrados, ${Math.max(...cells.map(c=>c[0]))+1} linhas por ${Math.max(...cells.map(c=>c[1]))+1} colunas${i===selected?', selecionada':''}`);
      }button.append(label);return button;
    }));
    $('rotate').disabled=status!=='playing';
  }
  $('undo').disabled=!previous;
  document.querySelectorAll('[data-direction]').forEach(button=>button.disabled=status!=='playing');
  $('end').hidden=status==='playing';$('continue').hidden=status!=='won';$('end-undo').hidden=!previous;
  if(status!=='playing'){
    $('end-title').textContent=status==='won'?(blocks?'Que belo encaixe!':'Seu jardim floresceu!'):(blocks?'Vamos tentar de novo?':'Todo jardim recomeça.');
    $('end-copy').textContent=status==='won'?`${blocks?'Você completou 12 linhas':'Você criou o Jardim 8'}! ${format(state.score)} pontos. Que tal continuar?`:`${blocks?'Nenhuma peça cabe, mesmo girando.':'Não há espaço nem plantas vizinhas iguais.'} Você fez ${format(state.score)} pontos.`;
  }
  persist();
  if(focusedCell!==null&&focusedCell!==undefined)board.children[Number(focusedCell)]?.focus({preventScroll:true});
  else if(focusedPiece!==undefined)$('tray')?.children[Number(focusedPiece)]?.focus({preventScroll:true});
}
function clearPreview(){board.querySelectorAll('.preview,.invalid').forEach(c=>c.classList.remove('preview','invalid'));}
function previewAt(index){
  clearPreview();if(!blocks || statusOf(state)!=='playing')return;
  const piece=state.tray[selected],row=Math.floor(index/6),col=index%6;
  const valid=fits(state.board,piece,row,col);
  for(const [r,c] of cellsFor(piece)) if(row+r<6&&col+c<6)board.children[(row+r)*6+col+c]?.classList.add(valid?'preview':'invalid');
}
function place(index){
  const result=placeBlock(state,selected,Math.floor(index/6),index%6);
  if(result.state===state){announce(statusOf(state)==='playing'?'Essa peça não cabe aí. Experimente girar ou escolher outro espaço.':'Esta partida terminou. Você pode desfazer ou recomeçar.');return;}
  previous=state;previousSelected=selected;state=result.state;render();
  result.cleared.forEach(i=>board.children[i].classList.add('cleared'));
  announce(statusOf(state)==='won'?'Meta alcançada: 12 linhas! Você pode continuar jogando.':statusOf(state)==='over'?'Fim de partida: nenhuma peça cabe, mesmo girando.':result.lines?`${result.lines} ${result.lines===1?'linha limpa':'linhas limpas'}! +${result.gained} pontos${state.combo>1?`. Combo ${state.combo}!`:'.'}`:`Boa escolha! +${result.gained} pontos. Encaixe a próxima peça.`);
}
function move(direction){
  const result=moveMerge(state,direction);
  if(result.state===state){announce(statusOf(state)==='playing'?'Nada se move nessa direção. Tente outra seta.':'Esta partida terminou. Escolha como continuar abaixo.');return;}
  previous=state;state=result.state;render();
  announce(statusOf(state)==='won'?'Seu Jardim 8 floresceu! Você pode continuar crescendo.':statusOf(state)==='over'?'Seu jardim está cheio e não há vizinhos iguais. Você pode desfazer ou começar outro.':result.gained?`Cresceu! +${result.gained} pontos. Maior planta: ${plantName(Math.max(...state.board))}.`:'Uma nova planta brotou. Combine níveis iguais para crescer.');
}
function undo(){if(!previous)return;state=previous;selected=previousSelected;previous=null;render();announce('Última jogada desfeita. Experimente outro caminho.');}
function restart(){state=create();previous=null;selected=0;$('restart-dialog').close();render();announce(blocks?'Novo ateliê pronto. Escolha a primeira peça.':'Novo jardim plantado. Qual será o primeiro movimento?');}
$('undo').addEventListener('click',undo);$('end-undo').addEventListener('click',undo);
for(const id of ['restart','end-restart'])$(id).addEventListener('click',()=>$('restart-dialog').showModal());
$('confirm-restart').addEventListener('click',restart);$('cancel-restart').addEventListener('click',()=>$('restart-dialog').close());
$('continue').addEventListener('click',()=>{state={...state,continued:true};render();announce('Continue à vontade. Agora o desafio é o seu recorde.');});
if(blocks){
  $('tray').addEventListener('click',event=>{const button=event.target.closest('[data-piece]');if(!button||button.disabled)return;selected=Number(button.dataset.piece);render();announce(`Peça ${selected+1} selecionada. Toque no canto onde ela deve começar.`);});
  $('rotate').addEventListener('click',()=>{state=rotateBlock(state,selected);render();announce('Peça girada. Escolha onde encaixar.');});
  board.addEventListener('click',event=>{const cell=event.target.closest('[data-index]');if(cell)place(Number(cell.dataset.index));});
  board.addEventListener('pointerover',event=>{const cell=event.target.closest('[data-index]');if(cell&&event.pointerType!=='touch')previewAt(Number(cell.dataset.index));});
  board.addEventListener('pointerleave',clearPreview);
  board.addEventListener('focusin',event=>{const i=Number(event.target.dataset.index);if(Number.isInteger(i))previewAt(i);});
  board.addEventListener('focusout',clearPreview);
  document.addEventListener('keydown',event=>{
    if($('restart-dialog').open||event.ctrlKey||event.metaKey||event.altKey)return;
    if(['1','2','3'].includes(event.key)){const i=Number(event.key)-1;if(state.tray[i]&&statusOf(state)==='playing'){selected=i;render();announce(`Peça ${i+1} selecionada.`);}return;}
    if(event.key.toLowerCase()==='r'){$('rotate').click();return;}
    if(!board.contains(event.target))return;
    const i=Number(event.target.dataset.index);let row=Math.floor(i/6),col=i%6;
    if(event.key==='ArrowRight')col=Math.min(5,col+1);else if(event.key==='ArrowLeft')col=Math.max(0,col-1);else if(event.key==='ArrowUp')row=Math.max(0,row-1);else if(event.key==='ArrowDown')row=Math.min(5,row+1);else return;
    event.preventDefault();board.querySelectorAll('button').forEach(c=>c.tabIndex=-1);board.children[row*6+col].tabIndex=0;board.children[row*6+col].focus();
  });
}else{
  document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>move(button.dataset.direction)));
  board.addEventListener('keydown',event=>{const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];if(direction){event.preventDefault();move(direction);}});
  board.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};board.setPointerCapture?.(event.pointerId);});
  board.addEventListener('pointercancel',()=>pointer=null);
  board.addEventListener('pointerup',event=>{if(!pointer||pointer.id!==event.pointerId)return;const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer=null;if(Math.max(Math.abs(dx),Math.abs(dy))<22)return;move(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));});
}
render();
if(saved)announce('Sua partida foi retomada. Pode continuar de onde parou.');
