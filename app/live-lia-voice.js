const LIVE_ENDPOINT = 'https://api.openai.com/v1/live/sessions';
const MAX_SDP_LENGTH = 65536;

export function validLiveOffer(sdp) {
  return typeof sdp === 'string' && sdp.length > 100 && sdp.length <= MAX_SDP_LENGTH && /^v=0\r?\n/.test(sdp) && /\r?\nm=audio /.test(sdp);
}

export async function createLiveLiaSession({sdp, apiKey, fetchImpl = fetch}) {
  if (!validLiveOffer(sdp)) throw Object.assign(new Error('Oferta de áudio inválida.'), {status: 400});
  if (!apiKey) throw Object.assign(new Error('Voz ao vivo não configurada.'), {status: 503});
  const response = await fetchImpl(LIVE_ENDPOINT, {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      session: {
        model: 'gpt-live-1',
        instructions: 'Você é Lia, assistente de voz da VitrineCity. Fale em português brasileiro de forma clara e natural. Responda perguntas gerais com concisão. Quando precisar de informação atual, peça ajuda ao backend. Não afirme que executou ações no site, nas redes ou no estúdio. Esta conversa é um teste privado de voz.',
        delegation: {
          type: 'responses',
          responses: {
            model: 'gpt-5.6-terra',
            instructions: 'Ajude Lia com respostas factuais e concisas em português brasileiro. Use pesquisa na web quando precisar de informação atual. Não execute ações externas nem afirme que realizou uma tarefa sem comprovante.',
            tools: [{type: 'web_search'}],
            tool_choice: 'auto'
          }
        }
      },
      transport: {type: 'webrtc', sdp}
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    console.warn('Lia Live session failed:', response.status);
    throw Object.assign(new Error(response.status === 403 ? 'O projeto OpenAI não liberou o modelo de voz ao vivo.' : 'Não foi possível iniciar a voz ao vivo. Confira a configuração da OpenAI.'), {status: 502});
  }
  const data = await response.json();
  if (!/^live_[\w-]+$/.test(data?.session?.id || '') || typeof data?.transport?.sdp !== 'string' || !data.transport.sdp.startsWith('v=0')) {
    throw Object.assign(new Error('A OpenAI retornou uma sessão de áudio inválida.'), {status: 502});
  }
  return {session: {id: data.session.id}, transport: {type: 'webrtc', sdp: data.transport.sdp}};
}

export function mountLiveLiaVoice({app, requireAdmin, sameOriginOnly, apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch}) {
  app.get('/api/admin/live-studio/lia/voice-live/status', requireAdmin, (_req, res) => {
    res.set('Cache-Control', 'no-store').json({configured: Boolean(apiKey), model: 'gpt-live-1'});
  });
  app.post('/api/admin/live-studio/lia/voice-live/session', requireAdmin, sameOriginOnly, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const result = await createLiveLiaSession({sdp: req.body?.sdp, apiKey, fetchImpl});
      res.status(201).json(result);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'A conexão expirou. A sessão pode ter sido iniciada; confira antes de tentar novamente.' :
        error?.status ? error.message : 'A conexão com a OpenAI falhou. Confira o serviço antes de tentar novamente.';
      res.status(error.status || 502).json({error: message});
    }
  });
}
