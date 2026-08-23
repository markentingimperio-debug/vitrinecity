function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function postalCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 8) throw new Error('postal_code_invalid');
  return digits;
}

export function melhorEnvioConfig(env = process.env) {
  const accessToken = String(env.MELHOR_ENVIO_ACCESS_TOKEN || '').trim();
  const originPostalCode = String(env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE || '').replace(/\D/g, '');
  const sandbox = /^(1|true|yes|sim)$/i.test(String(env.MELHOR_ENVIO_SANDBOX || 'false'));
  return {
    accessToken,
    originPostalCode,
    sandbox,
    configured: Boolean(accessToken && originPostalCode.length === 8),
    endpoint: sandbox ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br',
    userAgent: String(env.MELHOR_ENVIO_USER_AGENT || 'VitrineCity (agrotecnica362@gmail.com)').trim(),
    defaultWidthCm: boundedNumber(env.MARKETPLACE_DEFAULT_WIDTH_CM, 16, 2, 200),
    defaultHeightCm: boundedNumber(env.MARKETPLACE_DEFAULT_HEIGHT_CM, 8, 2, 200),
    defaultLengthCm: boundedNumber(env.MARKETPLACE_DEFAULT_LENGTH_CM, 24, 2, 200),
    freeShippingThresholdCents: Math.max(0, Number(env.MARKETPLACE_FREE_SHIPPING_CENTS) || 20000)
  };
}

export function automaticMarketplaceShipping(products, quantities, destinationPostalCode, env = process.env) {
  const postal = postalCode(destinationPostalCode);
  const subtotalCents = products.reduce((sum, product) => sum + product.price_cents * quantities.get(product.id), 0);
  const totalWeightGrams = products.reduce((sum, product) =>
    sum + Math.max(100, Number(product.weight_grams) || 500) * quantities.get(product.id), 0);
  const freeThreshold = Math.max(0, Number(env.MARKETPLACE_FREE_SHIPPING_CENTS) || 20000);
  const baseCents = Math.max(0, Number(env.MARKETPLACE_SHIPPING_BASE_CENTS) || 1190);
  const extraPer500g = Math.max(0, Number(env.MARKETPLACE_SHIPPING_PER_500G_CENTS) || 250);
  const zoneMultipliers = [10000, 10000, 10800, 10500, 11500, 12000, 13500, 12800, 11200, 11800];
  const zone = Number(postal[0]), weightBlocks = Math.max(1, Math.ceil(totalWeightGrams / 500));
  const calculated = Math.round((baseCents + (weightBlocks - 1) * extraPer500g) * (zoneMultipliers[zone] || 12000) / 10000);
  const shippingCents = freeThreshold > 0 && subtotalCents >= freeThreshold ? 0 : calculated;
  const productMin = Math.max(...products.map(product => Math.max(1, Number(product.delivery_min_days) || 3)));
  const productMax = Math.max(...products.map(product => Math.max(productMin, Number(product.delivery_max_days) || 7)));
  const zoneExtra = [0, 0, 1, 1, 2, 2, 4, 3, 2, 2][zone] ?? 3;
  return { provider: 'vitriny_table', service: 'Entrega econômica estimada', shippingCents, totalWeightGrams,
    deliveryMinDays: productMin + zoneExtra, deliveryMaxDays: productMax + zoneExtra,
    freeShipping: shippingCents === 0, freeShippingThresholdCents: freeThreshold, postalCode: postal,
    provisional: true };
}

export async function quoteMelhorEnvio({ products, quantities, destinationPostalCode, config = melhorEnvioConfig(),
  fetchImpl = fetch, timeoutMs = 12000 }) {
  if (!config.configured) throw new Error('melhor_envio_not_configured');
  const destination = postalCode(destinationPostalCode);
  const subtotalCents = products.reduce((sum, product) => sum + product.price_cents * quantities.get(product.id), 0);
  const body = {
    from: { postal_code: config.originPostalCode },
    to: { postal_code: destination },
    products: products.map(product => ({
      id: String(product.id), width: config.defaultWidthCm, height: config.defaultHeightCm,
      length: config.defaultLengthCm, weight: Math.max(0.1, Number(product.weight_grams || 500) / 1000),
      insurance_value: Number((product.price_cents / 100).toFixed(2)), quantity: quantities.get(product.id)
    })),
    options: { receipt: false, own_hand: false }
  };
  let response;
  try {
    response = await fetchImpl(`${config.endpoint}/api/v2/me/shipment/calculate`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json',
        authorization: `Bearer ${config.accessToken}`, 'user-agent': config.userAgent },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error('melhor_envio_unreachable');
  }
  if (!response?.ok) throw new Error(`melhor_envio_api_${Number(response?.status) || 502}`);
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) throw new Error('melhor_envio_invalid_response');
  const available = payload.map(item => {
    const price = Number(item?.custom_price ?? item?.price);
    const days = Number(item?.custom_delivery_time ?? item?.delivery_time);
    return { item, price, days };
  }).filter(entry => Number.isFinite(entry.price) && entry.price >= 0 && Number.isFinite(entry.days) && entry.days >= 1);
  if (!available.length) throw new Error('melhor_envio_no_service');
  available.sort((left, right) => left.price - right.price || left.days - right.days);
  const selected = available[0], freeThreshold = config.freeShippingThresholdCents;
  const quotedCents = Math.round(selected.price * 100);
  const shippingCents = freeThreshold > 0 && subtotalCents >= freeThreshold ? 0 : quotedCents;
  const carrier = String(selected.item?.company?.name || '').trim();
  const service = String(selected.item?.name || 'Entrega').trim();
  return { provider: 'melhor_envio', service: carrier ? `${carrier} · ${service}` : service,
    providerServiceId: String(selected.item?.id || ''), shippingCents, quotedCents,
    deliveryMinDays: Math.max(1, Math.floor(selected.days)), deliveryMaxDays: Math.max(1, Math.ceil(selected.days)),
    totalWeightGrams: products.reduce((sum, product) => sum + Math.max(100, Number(product.weight_grams) || 500) * quantities.get(product.id), 0),
    freeShipping: shippingCents === 0, freeShippingThresholdCents: freeThreshold, postalCode: destination,
    provisional: false };
}

export async function marketplaceShippingQuote(products, quantities, destinationPostalCode, options = {}) {
  const env = options.env || process.env, config = options.config || melhorEnvioConfig(env);
  if (config.configured) {
    try { return await quoteMelhorEnvio({ products, quantities, destinationPostalCode, config,
      fetchImpl: options.fetchImpl || fetch, timeoutMs: options.timeoutMs }); }
    catch (error) {
      if (options.fallback === false) throw error;
    }
  }
  return automaticMarketplaceShipping(products, quantities, destinationPostalCode, env);
}
