export const ADS_TERMS_VERSION='2026-09-08-ads-60';
export const ADS_VALIDITY_DAYS=60;
// Orders accepted under earlier terms keep their original ninety-day period.
export function creditExpiryForOrder(order,approvedAt,existingExpiry=null){return existingExpiry??approvedAt+(order.terms_version===ADS_TERMS_VERSION?ADS_VALIDITY_DAYS:90)*86400000;}
