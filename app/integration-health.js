// Only fixed diagnostic codes are retained: never provider payloads, tokens or prompts.
const AI_OPERATIONS = {
  openrouter_text: 'OpenRouter · texto',
  openrouter_media: 'OpenRouter · imagens e vídeos',
  openrouter_account: 'OpenRouter · consulta da conta'
};
const SOCIAL_PROVIDERS = {
  facebook: 'Facebook · métricas', instagram: 'Instagram · métricas',
  youtube: 'YouTube · métricas', tiktok: 'TikTok · métricas',
  google: 'Google · métricas', kwai: 'Kwai · métricas'
};
const GUIDANCE = {
  access_blocked: 'O provedor bloqueou a operação. Revise o aviso no painel do provedor ou procure o suporte.',
  authentication: 'A autenticação foi rejeitada. Revise a conexão no painel de integrações, sem enviar credenciais no chat.',
  permissions: 'Faltam permissões para a operação. Revise as permissões do aplicativo e reconecte a conta após a aprovação.',
  billing: 'O provedor informou uma restrição de crédito ou cobrança. A regularização depende do administrador.',
  rate_limit: 'O limite temporário do provedor foi atingido. Aguarde antes de tentar novamente.',
  unavailable: 'O provedor não respondeu ou apresentou instabilidade. Confira uma próxima execução.',
  not_configured: 'Esta integração ainda precisa ser configurada pelo administrador.',
  request_failed: 'A última operação falhou. Revise os registros internos e a configuração da integração.'
};

export function classifyIntegrationFailure(error = {}) {
  const message = String(error?.message || '');
  const status = Number(error?.status);
  if (/inference is blocked|access.blocked/i.test(message)) return 'access_blocked';
  if (/pages_read_user_content|permissions|required.permission/i.test(message) || [10, 200].includes(Number(error?.providerCode))) return 'permissions';
  if (/not_configured|Configure OPENROUTER_API_KEY/i.test(message)) return 'not_configured';
  if (status === 401 || Number(error?.providerCode) === 190 || /api_401/.test(message)) return 'authentication';
  if (status === 402) return 'billing';
  if (status === 403 || /api_403/.test(message)) return 'permissions';
  if (status === 429 || /api_429/.test(message)) return 'rate_limit';
  if (status >= 500 || /unreachable|timeout|api_5\d\d/i.test(message)) return 'unavailable';
  return 'request_failed';
}

export function openRouterOperation(url) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith('/key')) return 'openrouter_account';
  if (/\/(chat\/completions|responses)$/.test(pathname)) return 'openrouter_text';
  return 'openrouter_media';
}

export function createIntegrationObserver({ now = Date.now } = {}) {
  const observations = new Map();
  return {
    async run(id, operation) {
      if (!Object.hasOwn(AI_OPERATIONS, id)) throw new Error('Unknown integration operation');
      try {
        const result = await operation();
        observations.set(id, { status: 'completed', code: null, observedAt: new Date(now()).toISOString() });
        return result;
      } catch (error) {
        observations.set(id, { status: 'failed', code: classifyIntegrationFailure(error), observedAt: new Date(now()).toISOString() });
        throw error;
      }
    },
    snapshot() {
      return Object.entries(AI_OPERATIONS).map(([id, label]) => ({ id, label,
        ...(observations.get(id) || { status: 'unverified', code: null, observedAt: null }),
        source: 'current_process', href: '/admin-integracoes.html' }));
    }
  };
}

export const integrationObserver = createIntegrationObserver();

export function integrationHealth(db, { observer = integrationObserver, now = Date.now() } = {}) {
  const tableExists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_external_sync_runs'").get());
  const social = Object.entries(SOCIAL_PROVIDERS).map(([id, label]) => {
    const run = tableExists ? db.prepare(`SELECT status,error_code,started_at,finished_at
      FROM social_external_sync_runs WHERE provider=? ORDER BY started_at DESC,id DESC LIMIT 1`).get(id) : null;
    const rawDate = run?.finished_at || run?.started_at;
    const timestamp = rawDate ? Date.parse(rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + 'Z') : NaN;
    const rawCode = String(run?.error_code || '');
    const code = run?.status === 'failed' ? (Object.hasOwn(GUIDANCE, rawCode) ? rawCode : classifyIntegrationFailure({ message: rawCode })) : null;
    return { id, label, status: run?.status || 'unverified', code,
      observedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      source: 'sync_history', href: '/admin-metricas-externas.html' };
  });
  return [...observer.snapshot(), ...social].map(item => {
    const elapsed = item.observedAt ? now - Date.parse(item.observedAt) : Infinity;
    const stale = item.status === 'completed' && elapsed > 48 * 60 * 60 * 1000;
    const stalled = item.status === 'running' && elapsed > 60 * 60 * 1000;
    return { ...item, status: stalled ? 'stalled' : stale ? 'stale' : item.status,
      guidance: item.code ? GUIDANCE[item.code] : stalled ? 'A execução não registrou conclusão há mais de uma hora. Revise o processo.' : stale ? 'O último sucesso tem mais de 48 horas; não confirma a disponibilidade atual.' : item.status === 'completed' ? 'A última operação registrada foi concluída. Isso não garante todas as funções da integração.' : item.status === 'running' ? 'Há uma sincronização registrada em andamento.' : 'Nenhuma execução observada neste período; uma chave configurada não comprova funcionamento.' };
  });
}
