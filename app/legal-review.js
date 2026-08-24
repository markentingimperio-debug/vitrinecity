import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const LEGAL_DOCUMENTS = Object.freeze([
  { id: 'privacy', title: 'Política de Privacidade', file: 'privacy.html', expectedVersion: 'privacy-2026-08-22', scope: 'LGPD, dados pessoais e direitos dos titulares' },
  { id: 'digital-building', title: 'Termos do Prédio Digital', file: 'termos-predio-digital.html', expectedVersion: 'building-terms-2026-08-22', scope: 'Licença de vitrine digital e assinatura' },
  { id: 'marketplace', title: 'Termos do Marketplace', file: 'termos-marketplace.html', expectedVersion: 'marketplace-2026-08-22', scope: 'Relação entre plataforma, vendedor e comprador' },
  { id: 'seller', title: 'Política do Vendedor', file: 'politica-vendedor-marketplace.html', expectedVersion: 'seller-2026-08-22', scope: 'Cadastro, oferta, estoque e obrigações do vendedor' },
  { id: 'buyer', title: 'Política do Comprador', file: 'politica-comprador-marketplace.html', expectedVersion: 'buyer-2026-08-22', scope: 'Compra, atendimento e direitos do consumidor' },
  { id: 'returns', title: 'Política de Devolução', file: 'politica-devolucao-marketplace.html', expectedVersion: 'returns-2026-08-22', scope: 'Arrependimento, troca e devolução' },
  { id: 'cancellation', title: 'Política de Cancelamento', file: 'politica-cancelamento-marketplace.html', expectedVersion: 'cancellation-2026-08-22', scope: 'Cancelamento e reembolso' },
  { id: 'disputes', title: 'Política de Disputas', file: 'politica-disputas-marketplace.html', expectedVersion: 'disputes-2026-08-22', scope: 'Protocolos, mediação e contestação' },
  { id: 'tax', title: 'Responsabilidades Fiscais', file: 'politica-fiscal-marketplace.html', expectedVersion: 'fiscal-2026-08-22', scope: 'Documento fiscal, comissão e obrigações tributárias' },
  { id: 'ads-credits', title: 'Termos dos Créditos Ads', file: 'termos-creditos.html', expectedVersion: 'ads-credits-2026-08-19', scope: 'Créditos, taxa de gestão e publicidade' },
  { id: 'affiliates', title: 'Termos de Afiliados', file: 'termos-afiliados.html', expectedVersion: 'affiliate-terms-2026-08-22', scope: 'Indicação, comissão e pagamentos' }
]);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function textContent(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLegalReviewDossier(publicDir, { generatedAt = new Date().toISOString() } = {}) {
  const documents = LEGAL_DOCUMENTS.map(document => {
    const absolutePath = path.join(publicDir, document.file);
    const found = existsSync(absolutePath);
    const html = found ? readFileSync(absolutePath, 'utf8') : '';
    const visibleText = textContent(html);
    return {
      ...document,
      url: `/${document.file}`,
      found,
      versionDeclared: found && html.includes(document.expectedVersion),
      externalReviewNotice: found && /revis[aã]o jur[ií]dica/i.test(visibleText),
      sha256: found ? hash(html) : null
    };
  });
  const summary = {
    total: documents.length,
    found: documents.filter(document => document.found).length,
    versioned: documents.filter(document => document.versionDeclared).length,
    withExternalReviewNotice: documents.filter(document => document.externalReviewNotice).length
  };
  const blockingReasons = ['A revisão e a aprovação por profissional jurídico habilitado ainda não foram registradas.'];
  if (summary.found !== summary.total) blockingReasons.unshift('Há documentos jurídicos ausentes no pacote.');
  if (summary.versioned !== summary.total) blockingReasons.unshift('Há documentos sem o identificador de versão esperado.');
  return {
    status: 'pending_external_review',
    legalApproval: false,
    generatedAt,
    organization: {
      name: 'Agrotécnica Consultoria e Vendas Ltda.',
      taxId: '50.406.349/0001-04',
      platform: 'Vitrine City / Vitriny Social'
    },
    summary,
    blockingReasons,
    documents
  };
}
