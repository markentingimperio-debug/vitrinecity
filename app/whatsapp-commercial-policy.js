const GROUP = /^[0-9A-Za-z._:-]{1,140}@g\.us$/;
// The owner explicitly kept Receitas 06 without automated posting on 2026-09-11.
const NO_AUTOMATED_POSTING = new Set(['120363314271911782@g.us']);

// Private recipient policy shared by commercial previews, schedules and worker.
// A malformed exclusion list fails closed rather than silently allowing a group.
export function isWhatsAppCommercialGroupAllowed(groupJid, env = process.env) {
  const excluded = String(env.WHATSAPP_COMMERCIAL_EXCLUDED_GROUP_JIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if(excluded.some(value => !GROUP.test(value)))throw Object.assign(new Error('whatsapp_commercial_policy_invalid'),{code:'whatsapp_commercial_policy_invalid',status:503});
  return typeof groupJid === 'string' && GROUP.test(groupJid) && !NO_AUTOMATED_POSTING.has(groupJid) && !excluded.includes(groupJid);
}

export const WHATSAPP_COMMERCIAL_EXCLUDED_REASON = 'Grupo reservado: não recebe campanhas comerciais ou agendamentos promocionais.';
