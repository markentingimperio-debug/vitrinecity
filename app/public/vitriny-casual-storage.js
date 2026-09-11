// These scores belong only to this browser. They never create platform rewards.
export function randomStep(seed) {
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return [next, next / 4294967296];
}
export const boundedInt = (value, max = 1e9) => Number.isSafeInteger(value) && value >= 0 && value <= max;
export function readGame(storage, key, validate) {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 12000) return null;
    const data = JSON.parse(raw);
    return data?.version === 1 && validate(data.state) && boundedInt(data.best) ? data : null;
  } catch { return null; }
}
export function writeGame(storage, key, state, best) {
  try { storage.setItem(key, JSON.stringify({ version: 1, state, best })); return true; }
  catch { return false; }
}
