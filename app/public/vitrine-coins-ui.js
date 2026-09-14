import {coinAtoms,coinsFromAtoms} from './vitrine-coins-contract.js';

const localized = value => { const [whole, fraction] = value.split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : ''); };
/** Display-only. Accounting and comparisons always use canonical integer atoms. */
export const formatCoins = atoms => localized(coinsFromAtoms(atoms));
export function formatCoinBRL(atoms) {
  const scaled = (coinAtoms(atoms) * 100000000n + 48000000n) / 96000000n;
  const whole = scaled / 100000000n, fraction = (scaled % 100000000n).toString().padStart(8,'0').replace(/0+$/,'').padEnd(2,'0');
  return 'R$ ' + localized(whole.toString() + '.' + fraction);
}
export const coinSummary = atoms => formatCoins(atoms) + ' Vitrine Coins (' + formatCoinBRL(atoms) + ')';
