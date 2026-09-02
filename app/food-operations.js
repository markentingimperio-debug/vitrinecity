const TYPES = new Set(['retail', 'food', 'hybrid']);
const MODES = new Set(['delivery', 'pickup', 'both']);
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

const integer = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
};

export function normalizeStoreOperations(input = {}, current = {}) {
  const businessType = TYPES.has(input.businessType) ? input.businessType : (TYPES.has(current.business_type) ? current.business_type : 'retail');
  const preparationMinMinutes = integer(input.preparationMinMinutes, 0, 1440, Number(current.preparation_min_minutes) || 0);
  const preparationMaxMinutes = integer(input.preparationMaxMinutes, preparationMinMinutes, 1440, Math.max(preparationMinMinutes, Number(current.preparation_max_minutes) || preparationMinMinutes));
  const fulfillmentMode = MODES.has(input.fulfillmentMode) ? input.fulfillmentMode : (MODES.has(current.fulfillment_mode) ? current.fulfillment_mode : 'delivery');
  const rawHours = input.weeklyHours && typeof input.weeklyHours === 'object' ? input.weeklyHours : {};
  const weeklyHours = DAYS.map(day => {
    const value = rawHours[day];
    if (value == null || value.closed === true) return { day, closed: true, opens: null, closes: null };
    const opens = String(value.opens || ''), closes = String(value.closes || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opens) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closes) || opens >= closes) throw new Error(`invalid_hours_${day}`);
    return { day, closed: false, opens, closes };
  });
  return { businessType, preparationMinMinutes, preparationMaxMinutes,
    pickupInstructions: String(input.pickupInstructions ?? current.pickup_instructions ?? '').trim().slice(0, 500),
    acceptingOrders: input.acceptingOrders === undefined ? Boolean(current.accepting_orders ?? 1) : input.acceptingOrders === true,
    fulfillmentMode, weeklyHours };
}

export function deliveryEta({ preparationMinMinutes = 0, preparationMaxMinutes = 0, routeDurationSeconds = 0 }) {
  const routeMinutes = Math.max(1, Math.ceil(Number(routeDurationSeconds || 0) / 60));
  const minMinutes = Math.max(0, Number(preparationMinMinutes) || 0) + routeMinutes;
  const maxMinutes = Math.max(minMinutes, Number(preparationMaxMinutes) || 0) + routeMinutes;
  return { routeMinutes, etaMinMinutes: minMinutes, etaMaxMinutes: maxMinutes };
}

export const FOOD_ORDER_TRANSITIONS = Object.freeze({
  food_awaiting_acceptance: new Set(['food_accepted', 'cancel_requested']),
  food_accepted: new Set(['food_preparing', 'cancel_requested']),
  food_preparing: new Set(['food_ready', 'cancel_requested']),
  food_ready: new Set(['food_handed_off', 'cancel_requested']),
  food_handed_off: new Set(),
});

export function canTransitionFoodOrder(current, next) {
  return Boolean(FOOD_ORDER_TRANSITIONS[current]?.has(next));
}
