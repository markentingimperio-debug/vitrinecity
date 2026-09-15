export function validLiaQuote(value) {
  if (!value || !['originalAmountCents', 'discountCents', 'amountCents'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  if (value.originalAmountCents <= 0 || value.amountCents <= 0 || value.amountCents + value.discountCents !== value.originalAmountCents) return null;
  if (value.eligible === true) { if (value.couponCode !== 'LIA5' || value.percent !== 5 || value.discountCents !== Math.round(value.originalAmountCents / 20)) return null; }
  else if (value.eligible !== false || value.couponCode !== '' || value.percent !== 0 || value.discountCents !== 0) return null;
  return { originalAmountCents: value.originalAmountCents, discountCents: value.discountCents, amountCents: value.amountCents, couponCode: value.couponCode, eligible: value.eligible, percent: value.percent };
}
export const sameLiaQuote = (a, b) => !!a && !!b && a.originalAmountCents === b.originalAmountCents && a.discountCents === b.discountCents && a.amountCents === b.amountCents && a.couponCode === b.couponCode;
