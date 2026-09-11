export const LIA_COUPON_CODE = 'LIA5';
export const LIA_COUPON_STORE = 'official_agrotecnica';
export const isLiaOwnedProduct = product => product?.store_reference === LIA_COUPON_STORE && !String(product.product_url || '').trim();
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const cents = value => Number.isSafeInteger(value) && value >= 0;

// Round once for the cart, then allocate the remaining cents deterministically.
// Splitting units keeps quantity * unit price equal to every persisted subtotal.
export function priceLiaItems(items, eligible = false) {
  if (!Array.isArray(items) || !items.length || items.some(item => !cents(item.unitPriceCents) || item.unitPriceCents < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)) fail('Revise os valores e as quantidades do pedido.');
  const rows = items.map(item => ({ ...item, originalCents: item.unitPriceCents * item.quantity }));
  const originalAmountCents = rows.reduce((sum, item) => sum + item.originalCents, 0);
  if (!Number.isSafeInteger(originalAmountCents)) fail('O valor do pedido é inválido.');
  const discountCents = eligible === true ? Number((BigInt(originalAmountCents) * 5n + 50n) / 100n) : 0;
  const allocations = rows.map((item, index) => ({ index, discount: eligible === true ? Number(BigInt(item.originalCents) * 5n / 100n) : 0, remainder: Number(BigInt(item.originalCents) * 5n % 100n) }));
  let remaining = discountCents - allocations.reduce((sum, item) => sum + item.discount, 0);
  for (const allocation of [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) { if (!remaining) break; allocation.discount++; remaining--; }
  const lines = rows.flatMap((item, index) => {
    const net = item.originalCents - allocations[index].discount, unit = Math.floor(net / item.quantity), higher = net % item.quantity;
    return [[item.quantity - higher, unit], [higher, unit + 1]].filter(([quantity]) => quantity > 0).map(([quantity, unitPriceCents]) => ({ ...item, quantity, originalUnitPriceCents: item.unitPriceCents, unitPriceCents, subtotalCents: quantity * unitPriceCents, discountCents: quantity * (item.unitPriceCents - unitPriceCents) }));
  });
  return { couponCode: eligible === true ? LIA_COUPON_CODE : '', eligible: eligible === true, percent: eligible === true ? 5 : 0, originalAmountCents, discountCents, amountCents: originalAmountCents - discountCents, lines };
}

export function publicLiaQuote(quote) {
  const { couponCode, eligible, percent, originalAmountCents, discountCents, amountCents } = quote;
  return { couponCode, eligible, percent, originalAmountCents, discountCents, amountCents };
}

export function courseLiaQuote(course, eligible) {
  return priceLiaItems([{ id: course.slug, title: course.title, unitPriceCents: course.priceCents, quantity: 1 }], eligible === true);
}

export function assertLiaQuoteAccepted(body, quote, shippingCents = null) {
  if (body?.couponCode && body.couponCode !== LIA_COUPON_CODE) fail('Este cupom não está disponível para esta compra.');
  const expected = body?.expectedAmountCents;
  const mismatch = expected !== undefined && (!cents(expected) || expected !== quote.amountCents + (shippingCents ?? 0));
  // Older clients may still buy at their displayed full price. A newly available
  // or expired discount always requires a new explicit price confirmation.
  if (mismatch || (quote.eligible && (expected === undefined || body?.couponCode !== LIA_COUPON_CODE)) || (!quote.eligible && body?.couponCode === LIA_COUPON_CODE)) {
    const error = new Error('As condições da compra mudaram. Confira o novo total e confirme novamente antes de pagar.');
    error.status = 409; error.code = 'lia_quote_changed'; error.quote = publicLiaQuote(quote); if (shippingCents !== null) error.shippingCents = shippingCents; throw error;
  }
}

export function marketplaceLiaQuote(db, requested, eligible = false) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 30) fail('Selecione até 30 produtos para continuar.');
  const quantities = new Map(), requestedOptions = new Map();
  for (const item of requested) {
    const id = Number(item?.productId), quantity = Math.floor(Number(item?.quantity));
    if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) fail('Quantidade inválida no carrinho.');
    quantities.set(id, Math.min(50, (quantities.get(id) || 0) + quantity));
    const optionIds = Array.isArray(item?.optionIds) ? [...new Set(item.optionIds.map(Number).filter(Number.isInteger))].slice(0, 100) : [];
    if (requestedOptions.has(id) && JSON.stringify(requestedOptions.get(id)) !== JSON.stringify(optionIds)) fail('Separe itens com adicionais diferentes.');
    requestedOptions.set(id, optionIds);
  }
  const ids = [...quantities.keys()];
  const products = db.prepare(`SELECT p.*,s.business_name AS store_name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference
    WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.active=1 AND p.marketplace_enabled=1 AND p.price_cents>0 AND s.review_status='published' ORDER BY p.id`).all(...ids);
  if (products.length !== ids.length) fail('Um produto não está mais disponível.', 409);
  const storeReference = products[0].store_reference;
  if (products.some(product => product.store_reference !== storeReference)) fail('Finalize produtos de uma loja por vez.');
  if (products.some(product => product.stock_quantity < quantities.get(product.id))) fail('Estoque insuficiente para um dos produtos.', 409);
  const optionSnapshots = new Map();
  for (const product of products) {
    const selected = requestedOptions.get(product.id) || [], groups = db.prepare('SELECT * FROM product_option_groups WHERE product_id=? ORDER BY id').all(product.id), chosen = [];
    for (const group of groups) {
      const options = db.prepare(`SELECT id,name,price_delta_cents FROM product_options WHERE group_id=? AND active=1 AND id IN (${selected.length ? selected.map(() => '?').join(',') : 'NULL'})`).all(group.id, ...selected);
      if (options.length < group.min_select || options.length > group.max_select) fail(`Revise as opções de ${product.name}.`);
      chosen.push(...options.map(option => ({ id: option.id, groupId: group.id, group: group.name, name: option.name, priceDeltaCents: option.price_delta_cents })));
    }
    if (chosen.length !== selected.length) fail(`Um adicional de ${product.name} é inválido.`);
    optionSnapshots.set(product.id, chosen);
  }
  // Third-party storefronts and products bought at external URLs never qualify.
  const own = products.every(isLiaOwnedProduct);
  const quote = priceLiaItems(products.map(product => ({ id: product.id, title: product.name, unitPriceCents: product.price_cents + (optionSnapshots.get(product.id) || []).reduce((sum, item) => sum + item.priceDeltaCents, 0), quantity: quantities.get(product.id) })), eligible === true && own);
  return { ...quote, products, quantities, storeReference, optionSnapshots };
}
