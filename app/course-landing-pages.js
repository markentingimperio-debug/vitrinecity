import { COURSE_DEMONSTRATIONS, COURSE_LANDING_SLUGS } from './course-demonstrations.js';

export const AD_COURSES = Object.freeze(['canva-para-lojas', 'vendas-pelo-whatsapp', 'ia-para-pequenos-negocios']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => (cents / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const assetVersion = '20260911-course-checkout';

function shell({title, description, url, image, body, schema}) {
  return `<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)} | VitrineCity Educação</title><meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${esc(url)}"><meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(url)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
    <link rel="stylesheet" href="/course-landing.css?v=${assetVersion}">
    <script type="application/ld+json">${json(schema)}</script></head><body>
    <a class="skip" href="#conteudo">Pular para o conteúdo</a>
    <header class="site-header"><a class="brand" href="/cursos"><span class="brand-mark" aria-hidden="true">V</span>VitrineCity <span>Educação</span></a>
    <nav aria-label="Navegação principal"><a href="/centro-educacional">Todos os cursos</a><a href="/meus-cursos.html">Meus cursos</a></nav></header>
    ${body}<footer><strong>VitrineCity Educação</strong><p>Cursos livres para estudar e aplicar no seu ritmo.</p>
    <nav aria-label="Ajuda"><a href="/contato.html">Atendimento</a><a href="/portfolio">Portfólio da VitrineCity</a><a href="/privacy.html">Privacidade</a></nav></footer></body></html>`;
}

function renderDemonstration(demo) {
  if (!demo) return '';
  const scenarios = demo.scenarios.map((scenario, index) => {
    const example = scenario.messages
      ? `<ol class="demo-chat" aria-label="Conversa de atendimento ilustrativa">${scenario.messages.map(message => `<li class="${message.speaker === 'Loja' ? 'demo-message-store' : 'demo-message-customer'}"><strong>${esc(message.speaker)}</strong><p>${esc(message.text)}</p></li>`).join('')}</ol>`
      : `<div class="demo-example"><p class="eyebrow">EXEMPLO RESOLVIDO</p><p class="demo-example-text">${esc(scenario.example)}</p>${scenario.result ? `<h3>Resultado ilustrativo</h3><p>${esc(scenario.result)}</p>` : ''}</div>`;
    return `<details class="demo-scenario"${index === 0 ? ' open' : ''}>
      <summary>${esc(scenario.title)}</summary><div class="demo-content">
      <p class="demo-context">${esc(scenario.context)}</p><div class="demo-grid"><div>
      ${scenario.before ? `<div class="demo-before"><strong>O que pode melhorar</strong><p>${esc(scenario.before)}</p></div>` : ''}${example}</div>
      <aside class="demo-notes" aria-label="Explicação e atividade"><h3>Entenda a escolha</h3><p>${esc(scenario.explanation)}</p>
      <div class="demo-task"><p class="eyebrow">SUA VEZ</p><h3>Pratique com seu negócio</h3><p>${esc(scenario.task)}</p></div></aside></div></div></details>`;
  }).join('');
  return `<section class="course-demo" id="demonstracao" aria-labelledby="demo-title">
    <div class="demo-heading"><p class="eyebrow">AULA GRATUITA · SEM CADASTRO</p><h2 id="demo-title">${esc(demo.heading)}</h2>
    <p class="intro">${esc(demo.intro)}</p><p class="small">Exemplos didáticos com situações, produtos e valores ilustrativos. Abra cada exemplo para estudar e praticar.</p></div>
    ${scenarios}<div class="demo-next"><p>Esta é uma amostra. O curso completo reúne as aulas, atividades e checklists na sua área do aluno.</p>
    <a class="button" href="#inscricao">Gostei da aula · ver acesso</a></div></section>`;
}

function faq(demo) {
  const questions = [
    ['Posso experimentar antes de comprar?', demo ? 'Sim. A aula de demonstração desta página é gratuita e não exige cadastro. Os exemplos também fazem parte do módulo correspondente no curso completo.' : 'Confira o programa e fale com a equipe para esclarecer suas dúvidas.'],
    ['O curso tem videoaulas?', 'Este curso é composto por aulas em texto, atividades práticas e checklists na área do aluno. A oferta não inclui uma série de videoaulas.'],
    ['Como recebo o acesso?', 'Ao clicar em Comprar, confira o resumo e o preço. Na etapa de pagamento, entre ou crie sua conta, aceite as condições e continue no Mercado Pago. Após a aprovação, abra “Meus cursos” com a mesma conta.'],
    ['Existe certificado?', 'Ao concluir todas as aulas, você pode emitir um certificado nominal de curso livre com código público de validação. Não equivale a diploma de formação técnica ou superior.'],
    ['Preciso pagar pelas ferramentas mencionadas?', 'A inscrição inclui o conteúdo educacional da VitrineCity. Assinaturas, planos pagos ou recursos de ferramentas externas, quando necessários à sua atividade, são contratados separadamente. O curso não representa vínculo oficial com essas marcas.'],
    ['Há garantia de vendas ou renda?', 'Não. O curso oferece orientações e atividades para praticar. Os resultados dependem da aplicação, do negócio e de outros fatores.']
  ];
  return `<section class="faq"><p class="eyebrow">ANTES DE COMEÇAR</p><h2>Dúvidas sobre o acesso</h2>${questions.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join('')}<p class="support">Precisa esclarecer algo antes de comprar? <a href="/contato.html">Fale com a VitrineCity</a>.</p></section>`;
}

export function renderCourseLanding(course, original, origin) {
  const url = `${origin}/cursos/${course.slug}`;
  const image = new URL(original.coverUrl, origin).href;
  const demo = COURSE_DEMONSTRATIONS[course.slug];
  const price = money(course.priceCents);
  const checkoutUrl = '/course-checkout.html?curso=' + encodeURIComponent(course.slug);
  const curriculum = original.lessons.map(lesson => `<li><h3>${esc(lesson.title)}</h3><p>${esc(lesson.objective)}</p><p class="curriculum-task"><strong>Na prática:</strong> ${esc(lesson.activity)}</p></li>`).join('');
  const outcomes = demo ? `<ul class="learning-outcomes">${demo.outcomes.map(outcome => `<li>${esc(outcome)}</li>`).join('')}</ul>` : '';
  const body = `<main id="conteudo"><div class="breadcrumbs"><a href="/cursos">Cursos para seu negócio</a><span aria-hidden="true">/</span><span>${esc(course.title)}</span></div>
    <section class="hero"><div class="hero-copy"><p class="eyebrow">CURSO ORIGINAL · VITRINECITY</p><h1>${esc(course.title)}</h1>
    <p class="intro">${esc(course.description)}</p><ul class="facts"><li>${original.lessons.length} módulos</li><li>Online, no seu ritmo</li><li>Acesso individual</li></ul>
    <a class="button" href="${demo ? '#demonstracao' : '#programa'}">${demo ? 'Experimentar aula gratuita' : 'Ver o programa'}</a><a class="text-link" href="#inscricao">Ver acesso · ${esc(price)}</a>
    <p class="small">Aulas em texto, exercícios e checklists. ${demo ? 'Leia uma demonstração abaixo, sem entrar na conta. ' : ''}Curso independente, produzido pela VitrineCity.</p></div>
    <aside class="enrollment" aria-label="Inscrição no curso"><img src="${esc(original.coverUrl)}" alt="Capa do curso ${esc(course.title)}" width="640" height="420" fetchpriority="high">
    <div class="enrollment-content" id="inscricao"><p class="eyebrow">ACESSO AO CURSO COMPLETO</p><p class="price">${esc(price)}</p><p>Pagamento único pelo Mercado Pago.</p>
    <p class="small">${original.lessons.length} módulos em texto, atividades e checklists. Liberação em “Meus cursos” após a aprovação do pagamento.</p>
    <a class="button" href="${esc(checkoutUrl)}" data-course-purchase data-asset-type="course" data-asset-id="${esc(course.slug)}">Comprar acesso · ${esc(price)}</a>
    <p class="small">Você verá o resumo e o preço antes de entrar ou criar sua conta, na própria etapa de pagamento.</p><a class="text-link" href="/central-creditos.html?curso=${esc(course.slug)}">Consultar uso de recompensas</a></div></aside></section>
    ${renderDemonstration(demo)}
    <section class="audience"><p class="eyebrow">PARA QUEM É</p><h2>Aprendizado para a rotina do seu negócio</h2><p>${esc(course.audience)}.</p>${outcomes}
    <div class="benefits"><article><span>01</span><h3>Estude</h3><p>Leia as aulas e consulte os exemplos na área do aluno.</p></article>
    <article><span>02</span><h3>Coloque em prática</h3><p>Execute as atividades e use os checklists em cada módulo.</p></article>
    <article><span>03</span><h3>Acompanhe seu progresso</h3><p>Marque as aulas concluídas e avance no seu ritmo.</p></article></div></section>
    <section id="programa"><p class="eyebrow">O QUE VOCÊ VAI APRENDER</p><h2>Programa do curso</h2><ol class="curriculum">${curriculum}</ol></section>
    <section class="course-producer"><p class="eyebrow">QUEM PRODUZ</p><h2>Conheça a VitrineCity</h2><p>Este é um curso original da VitrineCity. Conheça a cidade digital, os projetos e a operação que reúne educação e comércio.</p><a class="text-link" href="/portfolio">Ver o portfólio da VitrineCity →</a></section>
    ${faq(demo)}</main><script src="/course-landing.js?v=${assetVersion}" defer></script>`;
  return shell({title:course.title, description:course.description, url, image, body, schema:{'@context':'https://schema.org','@type':'Course',name:course.title,description:course.description,identifier:`course-${course.slug}`,url,image,inLanguage:'pt-BR',provider:{'@type':'Organization',name:'VitrineCity',url:origin},offers:{'@type':'Offer',price:(course.priceCents/100).toFixed(2),priceCurrency:'BRL',availability:'https://schema.org/InStock',url}}});
}

export function setupCourseLandingPages({app, managedCourse, courseReady, originalCourse, origin}) {
  const selected = () => COURSE_LANDING_SLUGS.map(managedCourse).filter(c => c?.status === 'active' && courseReady(c.slug) && originalCourse(c.slug)?.lessons?.length);
  app.get('/cursos', (_req,res) => {
    const courses = selected();
    const cards = courses.map(c => `<article class="course-card"><a href="/cursos/${c.slug}"><img src="${esc(originalCourse(c.slug).coverUrl)}" alt="Capa de ${esc(c.title)}" width="640" height="420"><div><p class="eyebrow">COM AULA GRATUITA</p><h2>${esc(c.title)}</h2><p>${esc(c.description)}</p><p><strong>${esc(money(c.priceCents))}</strong> · ${originalCourse(c.slug).lessons.length} módulos</p><span class="text-link">Experimentar e conhecer o curso →</span></div></a></article>`).join('');
    res.type('html').set('Cache-Control','no-store').send(shell({title:'Cursos para seu negócio', description:'Experimente aulas gratuitas de WhatsApp, Canva, IA, precificação, comércio digital e outros cursos originais da VitrineCity.', url:`${origin}/cursos`, body:`<main id="conteudo"><section class="index-intro"><p class="eyebrow">VITRINECITY EDUCAÇÃO</p><h1>Experimente uma aula.<br>Aplique no seu negócio.</h1><p class="intro">Conheça exemplos práticos sem cadastro. Depois, escolha o curso completo com aulas em texto, atividades e checklists.</p></section><section class="course-grid" aria-label="Cursos selecionados">${cards}</section><p class="support"><a href="/centro-educacional">Ver o catálogo completo de cursos</a></p></main>`, schema:{'@context':'https://schema.org','@type':'ItemList',itemListElement:courses.map((c,i)=>({'@type':'ListItem',position:i+1,url:`${origin}/cursos/${c.slug}`,name:c.title}))}}));
  });
  app.get('/cursos/:slug', (req,res) => {
    const course = selected().find(c=>c.slug===req.params.slug);
    if (!course) return res.status(404).type('html').send(shell({title:'Curso indisponível',description:'Confira os cursos disponíveis da VitrineCity.',url:`${origin}/cursos`,body:'<main id="conteudo"><h1>Curso indisponível</h1><p><a href="/cursos">Ver cursos disponíveis</a></p></main>',schema:{}}));
    return res.type('html').set('Cache-Control','no-store').send(renderCourseLanding(course, originalCourse(course.slug), origin));
  });
  return {sitemapPaths:()=>['/cursos',...selected().map(c=>`/cursos/${c.slug}`)]};
}
