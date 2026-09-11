const DAY = 86400000;
const GIFT_PATH = '/presente.html?guia=zamioculca';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plants = value => /\b(plantas?|jardinagem|jardim|zamioculcas?|adubos?|substratos?|vasos?|sementes?|fertilizantes?|horta|regas?|cultivo)\b/.test(value);
const giftWords = value => /\b(presentes?|guias?|e-?books?|livros?)\b/.test(value);
const otherGuide = value => /\b(receitas?|culinaria|cozinha|bolo|bolos|esportes?|futebol|tecnologia|programacao|financas?|oracao|oracoes)\b/.test(value);
const giftRefusal = value => /\b(?:nao (?:quero|vou|preciso|aceito)(?: mais)?(?: receber| de)? (?:o |um |esse |este |nenhum |esses |estes )?(?:presentes?|guias?|e-?books?|livros?)|prefiro nao)\b/.test(value);
const refusal = value => giftRefusal(value) || /^(?:nao|nao quero|nao vou|nao preciso)[.! ]*$/.test(value)
  || /\b(?:nao[,]? obrigad[oa]|(?:agora|hoje) nao|nao quero (?:comprar|ofertas)|sem ofertas|nao tenho interesse|so (?:estou )?olhando)\b/.test(value);
const acknowledges = value => value.length <= 140 && !/[?]/.test(value)
  && /\b(obrigad[oa]|agradeco|me ajudou|ajudou muito|entendi|esclareceu)\b/.test(value)
  && !/\b(mas|porem|ainda|nao|preciso|como|quero|medo|triste|dor|sofrendo)\b/.test(value);

function explicitRequest(value, state) {
  if (!giftWords(value) || otherGuide(value)) return false;
  const asks = /\b(quero|gostaria|posso|como|onde|receber|ganhar|abrir|acessar|tem|oferece|oferecem|me (?:mostra|mostre|manda|envia))\b/.test(value);
  return asks && (/\b(presente|gratis|gratuito|gratuita|gratuitamente|zamioculca|de graca|sem custo)\b/.test(value) || state?.invited_ms != null);
}

function availableGift(getGift) {
  try {
    const gift = getGift();
    if (gift?.available !== true || gift.id !== 'zamioculca' || gift.topic !== 'plants' || gift.amountCents !== 0 || typeof gift.title !== 'string') return null;
    const title = gift.title.replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    return title ? { title } : null;
  } catch { return null; }
}

// The caller runs decorate inside the same transaction that saves the reply.
// This ledger contains only opaque session IDs and times, never contact data.
export function setupSiteAssistantGiftInvitation({ db, getGift = () => null, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS site_assistant_gift_invitations(
    session_id TEXT PRIMARY KEY, helped_ms INTEGER, invited_ms INTEGER,
    declined_ms INTEGER, expires_ms INTEGER NOT NULL
  )`);
  function decorate(session, context, message, nav, reply) {
    const timestamp = now();
    db.prepare('DELETE FROM site_assistant_gift_invitations WHERE expires_ms<=?').run(timestamp);
    if (!session || typeof session.id !== 'string' || !session.id || !context || typeof message !== 'string' || !message.trim()) return null;
    const input = normalize(message.trim());
    if (context.kind === 'prayer' || /\b(oracao|oracoes|orar|rezar)\b/.test(input)) return null;
    const gift = availableGift(getGift);
    if (!gift) return null;
    const state = db.prepare('SELECT * FROM site_assistant_gift_invitations WHERE session_id=?').get(session.id);
    const explicit = explicitRequest(input, state);
    const declined = refusal(input);
    // A request for the gift may coexist with declining a purchase. A refusal
    // of the gift itself always wins within the current message.
    const giftDeclined = giftWords(input) && giftRefusal(input);
    const record = () => db.prepare('INSERT OR IGNORE INTO site_assistant_gift_invitations(session_id,expires_ms) VALUES(?,?)').run(session.id, timestamp + DAY);
    if (giftDeclined || declined && !explicit) {
      record();
      db.prepare('UPDATE site_assistant_gift_invitations SET declined_ms=COALESCE(declined_ms,?) WHERE session_id=?').run(timestamp, session.id);
      return null;
    }
    if (otherGuide(input) || context.kind === 'recipe' && !plants(input)) return null;
    if (!explicit) {
      const plantContext = context.group === 'plants' || plants(input);
      if (!plantContext || context.kind === 'recipe') return null;
      // A greeting, bare catalogue opening or unanswered question is not help.
      const answer = String(reply || '').trim();
      const contextualNeed = plants(input) || context.group === 'plants' && /\b(regar|cuidar|cuido|cultivar|folhas?|raizes?|amarelad[oa]s?|podar|luz|drenagem)\b/.test(input);
      const helped = !acknowledges(input) && contextualNeed && answer.length >= 20
        && !/\b(nao (?:sei|encontrei|consigo)|indisponivel|tente (?:novamente|mais tarde))\b/.test(normalize(answer))
        && (!answer.endsWith('?') || /[.!]\s+\S/.test(answer) || (nav?.actions || []).length > 0);
      if (helped) {
        record();
        db.prepare('UPDATE site_assistant_gift_invitations SET helped_ms=COALESCE(helped_ms,?) WHERE session_id=?').run(timestamp, session.id);
      }
      if (!state || state.declined_ms != null || state.invited_ms != null || state.helped_ms == null || !acknowledges(input)) return null;
      if (!db.prepare('UPDATE site_assistant_gift_invitations SET invited_ms=? WHERE session_id=? AND invited_ms IS NULL AND declined_ms IS NULL AND helped_ms IS NOT NULL').run(timestamp, session.id).changes) return null;
    } else {
      record();
      db.prepare('UPDATE site_assistant_gift_invitations SET invited_ms=COALESCE(invited_ms,?),declined_ms=NULL WHERE session_id=?').run(timestamp, session.id);
    }
    return {
      reply: `Posso te oferecer “${gift.title}” gratuitamente. Para receber o acesso por e-mail, cadastre-se ou entre pelo formulário aqui na conversa, sem obrigação de comprar ou receber promoções.`,
      actions: [{ label: 'Receber guia gratuito', url: GIFT_PATH, kind: 'internal', assetType: 'navigation', assetId: 'gift:zamioculca' }],
      contactOffer: null,
      offers: []
    };
  }
  return { decorate };
}
