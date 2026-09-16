import { randomStep, boundedInt } from './vitriny-casual-storage.js';
export const PLANTS = ['','Semente','Broto','Muda','Botão','Flor','Arbusto','Árvore','Jardim','Bosque','Floresta','Reserva','Paraíso'];
export const plantName = level => PLANTS[level] || `Jardim nível ${level}`;
function spawn(state) {
  const empty = state.board.map((v,i) => v ? -1 : i).filter(i=>i>=0);
  if (!empty.length) return state;
  let seed, pick, value;
  [seed,pick] = randomStep(state.seed);
  [seed,value] = randomStep(seed);
  const board = [...state.board];
  board[empty[Math.floor(pick*empty.length)]] = value < 0.9 ? 1 : 2;
  return {...state,board,seed};
}
export function newMerge(seed=Date.now()) {
  return spawn(spawn({board:Array(16).fill(0),score:0,moves:0,seed:seed>>>0,continued:false}));
}
export function mergeStatus(state) {
  if (Math.max(...state.board)>=8 && !state.continued) return 'won';
  if (state.board.some(v=>!v)) return 'playing';
  for (let r=0;r<4;r++) for (let c=0;c<4;c++) {
    const i=r*4+c;
    if ((r<3 && state.board[i]===state.board[i+4]) || (c<3 && state.board[i]===state.board[i+1])) return 'playing';
  }
  return 'over';
}
export function mergeLine(line) {
  const compact=line.filter(Boolean), result=[]; let gained=0;
  for(let i=0;i<compact.length;i++) {
    if(compact[i]===compact[i+1]) {const level=compact[i]+1;result.push(level);gained+=2**level;i++;}
    else result.push(compact[i]);
  }
  while(result.length<4) result.push(0);
  return {line:result,gained};
}
export function moveMerge(state,direction) {
  if (!['up','down','left','right'].includes(direction) || mergeStatus(state)!=='playing') return {state,gained:0};
  const board=[...state.board];let gained=0;
  for(let n=0;n<4;n++) {
    const indices=Array.from({length:4},(_,j)=> direction==='left' ? n*4+j : direction==='right' ? n*4+3-j : direction==='up' ? j*4+n : (3-j)*4+n);
    const merged=mergeLine(indices.map(i=>board[i]));gained+=merged.gained;
    indices.forEach((i,j)=>board[i]=merged.line[j]);
  }
  if(board.every((v,i)=>v===state.board[i])) return {state,gained:0};
  return {state:spawn({...state,board,score:state.score+gained,moves:state.moves+1}),gained};
}
export function validMerge(s) {
  return !!s && Array.isArray(s.board) && s.board.length===16 && s.board.every(v=>boundedInt(v,30)) && s.board.some(Boolean) &&
    ['score','moves'].every(k=>boundedInt(s[k],Number.MAX_SAFE_INTEGER)) && boundedInt(s.seed,4294967295) && typeof s.continued==='boolean';
}
