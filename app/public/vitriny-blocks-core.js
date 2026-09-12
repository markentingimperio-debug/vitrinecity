import { randomStep, boundedInt } from './vitriny-casual-storage.js';
export const SIZE = 6;
export const SHAPES = [
  [[0,0]], [[0,0],[0,1]], [[0,0],[0,1],[0,2]],
  [[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[1,1]],
  [[0,0],[0,1],[1,0],[1,1]], [[0,0],[1,0],[2,0],[2,1]],
  [[0,0],[0,1],[0,2],[1,1]], [[0,1],[0,2],[1,0],[1,1]],
];
export function cellsFor(piece) {
  let cells = SHAPES[piece.shape].map(cell => [...cell]);
  for (let i = 0; i < piece.rotation; i++) {
    cells = cells.map(([r,c]) => [c,-r]);
    const minR = Math.min(...cells.map(c => c[0])), minC = Math.min(...cells.map(c => c[1]));
    cells = cells.map(([r,c]) => [r-minR,c-minC]);
  }
  return cells;
}
export function fits(board, piece, row, col) {
  return !!piece && Number.isInteger(row) && Number.isInteger(col) && cellsFor(piece).every(([r,c]) =>
    r+row >= 0 && c+col >= 0 && r+row < SIZE && c+col < SIZE && board[(r+row)*SIZE+c+col] === 0);
}
export function canPlace(board, piece) {
  if (!piece) return false;
  for (let rotation=0; rotation<4; rotation++) for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
    if (fits(board,{...piece,rotation},r,c)) return true;
  }
  return false;
}
function refill(state) {
  const next = { ...state, tray: [] };
  for (let i=0;i<3;i++) {
    let value;
    [next.seed,value] = randomStep(next.seed);
    next.tray.push({ shape: Math.floor(value*SHAPES.length), rotation: 0, color: i+1 });
  }
  // A fresh tray always gives at least one playable piece; later choices still matter.
  if (!next.tray.some(p => canPlace(next.board,p))) next.tray[0].shape = 0;
  return next;
}
export function newBlocks(seed = Date.now()) {
  return refill({ board: Array(36).fill(0), tray: [], score: 0, lines: 0, combo: 0, moves: 0, seed: seed >>> 0, continued: false });
}
export function blocksStatus(state) {
  if (state.lines >= 12 && !state.continued) return 'won';
  return state.tray.some(p => canPlace(state.board,p)) ? 'playing' : 'over';
}
export function rotateBlock(state, index) {
  if (!state.tray[index] || blocksStatus(state) !== 'playing') return state;
  return {...state, tray: state.tray.map((p,i) => i === index ? {...p, rotation: (p.rotation+1)%4} : p)};
}
export function placeBlock(state, index, row, col) {
  const piece = state.tray[index];
  if (blocksStatus(state) !== 'playing' || !fits(state.board,piece,row,col)) return {state, cleared: [], gained: 0};
  const board = [...state.board];
  for (const [r,c] of cellsFor(piece)) board[(r+row)*SIZE+c+col] = piece.color;
  const rows = [], cols = [];
  for (let i=0;i<SIZE;i++) {
    if (Array.from({length:SIZE},(_,j) => board[i*SIZE+j]).every(Boolean)) rows.push(i);
    if (Array.from({length:SIZE},(_,j) => board[j*SIZE+i]).every(Boolean)) cols.push(i);
  }
  const cleared = [];
  for (let i=0;i<36;i++) if (rows.includes(Math.floor(i/SIZE)) || cols.includes(i%SIZE)) { board[i]=0; cleared.push(i); }
  const lines = rows.length+cols.length, combo = lines ? state.combo+1 : 0;
  const gained = cellsFor(piece).length*5 + lines*60*combo + (lines>1 ? 40*(lines-1) : 0);
  let next = {...state, board, tray:state.tray.map((p,i) => i===index ? null : p), score:state.score+gained,
    lines:state.lines+lines, combo, moves:state.moves+1};
  if (next.tray.every(p => !p)) next = refill(next);
  return {state:next, cleared, gained, lines};
}
export function validBlocks(s) {
  return !!s && Array.isArray(s.board) && s.board.length===36 && s.board.every(n=>boundedInt(n,3)) &&
    Array.isArray(s.tray) && s.tray.length===3 && s.tray.some(Boolean) && s.tray.every(p => p===null ||
      (p && boundedInt(p.shape,SHAPES.length-1) && boundedInt(p.rotation,3) && [1,2,3].includes(p.color))) &&
    ['score','lines','combo','moves'].every(k=>boundedInt(s[k])) && boundedInt(s.seed,4294967295) && typeof s.continued==='boolean';
}
