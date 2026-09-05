const DEFAULTS = Object.freeze({
  baseFeeCents: 500,
  baseDistanceMeters: 1000,
  additionalKmCents: 50,
  platformCommissionBps: 1000,
  maxDistanceMeters: 30000
});

export function calculateLocalDelivery(distanceMeters, settings = {}) {
  const distance = Math.ceil(Number(distanceMeters));
  if (!Number.isFinite(distance) || distance < 0) throw new Error('distance_invalid');
  const baseFeeCents = Number(settings.baseFeeCents ?? DEFAULTS.baseFeeCents);
  const baseDistanceMeters = Number(settings.baseDistanceMeters ?? DEFAULTS.baseDistanceMeters);
  const additionalKmCents = Number(settings.additionalKmCents ?? DEFAULTS.additionalKmCents);
  const platformCommissionBps = Number(settings.platformCommissionBps ?? DEFAULTS.platformCommissionBps);
  const maxDistanceMeters = Number(settings.maxDistanceMeters ?? DEFAULTS.maxDistanceMeters);
  if (![baseFeeCents,baseDistanceMeters,additionalKmCents,platformCommissionBps,maxDistanceMeters].every(Number.isInteger) ||
      baseFeeCents < 0 || baseDistanceMeters < 1 || additionalKmCents < 0 || platformCommissionBps < 0 ||
      platformCommissionBps > 10000 || maxDistanceMeters < baseDistanceMeters) throw new Error('settings_invalid');
  if (distance > maxDistanceMeters) throw new Error('distance_out_of_range');
  const additionalKm = Math.max(0, Math.ceil((distance - baseDistanceMeters) / 1000));
  const feeCents = baseFeeCents + additionalKm * additionalKmCents;
  const platformCents = Math.round(feeCents * platformCommissionBps / 10000);
  return { distanceMeters: distance, distanceKm: Math.round(distance / 10) / 100, additionalKm, feeCents,
    platformCents, courierCents: feeCents - platformCents };
}

export async function googleRouteDistance({ origin, destination, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('routes_not_configured');
  const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey,
      'x-goog-fieldmask': 'routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: { address: origin }, destination: { address: destination },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', languageCode: 'pt-BR', units: 'METRIC' }),
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => null);
  const route = payload?.routes?.[0];
  if (!response.ok || !Number.isFinite(Number(route?.distanceMeters))) throw new Error('route_unavailable');
  return { distanceMeters: Math.ceil(Number(route.distanceMeters)), duration: String(route.duration || '') };
}

export function formatDeliveryAddress(row) {
  return [row.address || row.street, row.number, row.neighborhood, row.city, row.state,
    row.postal_code ? `CEP ${row.postal_code}` : ''].filter(Boolean).join(', ');
}

export { DEFAULTS as LOCAL_DELIVERY_DEFAULTS };
