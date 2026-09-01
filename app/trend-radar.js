import { randomUUID } from "node:crypto";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const slugify = (value) =>
  String(value || "artigo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
const decodeXml = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const tag = (xml, name) =>
  decodeXml(
    xml.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
    )?.[1] || "",
  ).trim();

function portalFor(title) {
  const text = title.toLowerCase();
  if (/planta|jardin|horta|flor|orquidea|suculenta|adubo|vaso|folhagem/.test(text))
    return "plantas-e-jardinagem";
  if (
    /futebol|jogo|campeonato|brasileir|copa|gol|time|atlet|corrida|ufc|nba|volei/.test(
      text,
    )
  )
    return "esportes";
  if (
    /receita|bolo|frango|carne|arroz|sobremesa|cozinha|ingrediente|doce|pao/.test(
      text,
    )
  )
    return "receitas";
  if (
    /inteligencia artificial|inteligência artificial|\bia\b|chatgpt|gemini|openai|claude|modelo de linguagem|agente de ia/.test(
      text,
    )
  )
    return "inteligencia-artificial";
  if (
    /tecnologia|aplicativo|software|celular|smartphone|internet|computador|inovacao|inovação|startup|seguranca digital|segurança digital/.test(
      text,
    )
  )
    return "tecnologia";
  if (
    /famos|atriz|ator|cantor|cantora|celebridade|reality|novela|influenciador|influencer|entretenimento|cinema|televisao|televisão/.test(
      text,
    )
  )
    return "entretenimento";
  return "noticias";
}

function renderIndex(portal, rows) {
  const names = {
    conteudo: "Conteúdos em destaque",
    noticias: "Vitrine Notícias",
    esportes: "Vitrine Esportes",
    receitas: "Vitrine Receitas",
    "plantas-e-jardinagem": "Plantas e Jardinagem",
    tecnologia: "Vitrine Tecnologia",
    "inteligencia-artificial": "Vitrine Inteligência Artificial",
    entretenimento: "Vitrine Famosos e Entretenimento",
  };
  const cards =
    rows
      .map(
        (row) =>
          `<article><a href="/artigo/${esc(row.slug)}"><img src="${esc(row.image_url || "/assets/vitriny-city-master.jpg")}" alt=""><div><small>${esc(row.portal)}</small><h2>${esc(row.title)}</h2><p>${esc(row.summary)}</p><span>Ler artigo →</span></div></a></article>`,
      )
      .join("") ||
    '<div class="empty">Os primeiros artigos estão em preparação editorial.</div>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(names[portal])} — VitrineCity</title><meta name="description" content="Notícias, tecnologia, inteligência artificial, entretenimento e conteúdos úteis selecionados pela VitrineCity."><style>${INDEX_CSS}</style></head><body><header><a href="/">VitrineCity</a><nav><a href="/noticias">Notícias</a><a href="/tecnologia">Tecnologia</a><a href="/inteligencia-artificial">IA</a><a href="/entretenimento">Famosos</a><a href="/social">Vitriny Social</a></nav></header><main><div class="hero"><small>CONTEÚDO COM REVISÃO EDITORIAL</small><h1>${esc(names[portal])}</h1><p>Tendências transformadas em conteúdo útil, com fontes identificadas e revisão antes da publicação.</p></div><section>${cards}</section></main><footer>VitrineCity · conteúdo informativo · <a href="/contato.html">Contato</a></footer></body></html>`;
}

function renderArticle(row, products = []) {
  const sources = JSON.parse(row.sources_json || "[]");
  const articleUrl = `https://vitrinecity.com/artigo/${encodeURIComponent(row.slug)}`;
  const absoluteImage = new URL(
    row.image_url || "/assets/vitriny-city-master.jpg",
    "https://vitrinecity.com",
  ).href;
  const seoKeywords = [...new Set([
    row.portal.replaceAll("-", " "),
    ...String(row.title).toLowerCase().split(/\s+/).filter(word => word.length > 3),
    "VitrineCity",
  ])].slice(0, 12).join(", ");
  const paragraphs = String(row.body || "")
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
  const sourceList = sources
    .map(
      (s) =>
        `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`,
    )
    .join("");
  const adContext = JSON.stringify(`${row.portal} ${row.title}`).replace(/</g, "\\u003c");
  const productCarousel = products.length
    ? `<section class="context-ad" id="contextAd" hidden><small>CONTEÚDO PATROCINADO</small><a rel="nofollow sponsored"><img alt=""><span><b></b><em></em></span></a></section><script>fetch('/api/ads/serve?placement=banner&context='+encodeURIComponent(${adContext})).then(r=>r.json()).then(d=>{const ad=d.ads?.[0];if(!ad)return;const box=document.getElementById('contextAd'),link=box.querySelector('a'),img=box.querySelector('img');link.href=ad.clickUrl;box.querySelector('b').textContent=ad.title;box.querySelector('em').textContent=ad.text;if(ad.imageUrl){img.src=ad.imageUrl;img.alt=ad.title}else img.remove();box.hidden=false}).catch(()=>{})<\/script><section class="products"><div class="products-head"><div><small>VITRINECITY LOJA</small><h2>Produtos relacionados ao assunto</h2></div><a href="/loja">Ver catálogo completo →</a></div><div class="product-track">${products.map(product => `<a class="product-card" href="/produto/${encodeURIComponent(product.id)}/${esc(slugify(product.name))}"><img src="${esc(product.image_url || "/assets/vitriny-city-master.jpg")}" alt="${esc(product.name)}"><span>${esc(product.store_name)}</span><strong>${esc(product.name)}</strong><b>${(Number(product.price_cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></a>`).join("")}</div></section>`
    : "";
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": row.portal === "noticias" ? "NewsArticle" : "Article",
    headline: row.title,
    description: row.summary,
    image: [
      absoluteImage,
    ],
    mainEntityOfPage: articleUrl,
    keywords: seoKeywords,
    datePublished: row.published_at,
    dateModified: row.updated_at,
    author: { "@type": "Organization", name: "VitrineCity" },
    publisher: { "@type": "Organization", name: "VitrineCity" },
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(row.title)} — VitrineCity</title><meta name="description" content="${esc(row.summary)}"><meta name="keywords" content="${esc(seoKeywords)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="article"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="VitrineCity"><meta property="og:title" content="${esc(row.title)}"><meta property="og:description" content="${esc(row.summary)}"><meta property="og:url" content="${esc(articleUrl)}"><meta property="og:image" content="${esc(absoluteImage)}"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(articleUrl)}"><script type="application/ld+json">${schema}</script><style>${ARTICLE_CSS}</style></head><body><header><a href="/">VitrineCity</a><a href="/${esc(row.portal)}">← Voltar</a></header><main><small>${esc(row.portal.toUpperCase())}</small><h1>${esc(row.title)}</h1><p class="summary">${esc(row.summary)}</p><img class="cover" src="${esc(row.image_url || "/assets/vitriny-city-master.jpg")}" alt="${esc(row.title)}" width="1200" height="675"><article>${paragraphs}</article>${sourceList ? `<aside><h2>Fontes consultadas</h2><ul>${sourceList}</ul></aside>` : ""}<p class="review">Conteúdo revisado antes da publicação. Informações podem ser atualizadas conforme novas fontes.</p>${productCarousel}</main></body></html>`;
}

const INDEX_CSS = `:root{--blue:#1768e6;--navy:#071f4b;--yellow:#ffc628;--bg:#f4f9ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--navy);font-family:Inter,Arial,sans-serif}header{height:72px;padding:0 max(18px,6vw);display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #d8e7f7}header>a{font-size:25px;font-weight:950;text-decoration:none}nav{display:flex;gap:18px}nav a{font-weight:850;text-decoration:none}.hero{padding:70px 20px;text-align:center;background:linear-gradient(135deg,#061c44,#1768e6);color:#fff}.hero small{color:var(--yellow);font-weight:950}.hero h1{font-size:clamp(40px,7vw,72px);margin:10px}.hero p{max-width:700px;margin:auto;color:#d5e5ff}main section{max-width:1120px;margin:auto;padding:45px 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:#fff;border:1px solid #d8e7f7;border-radius:20px;overflow:hidden}article a{text-decoration:none}article img{width:100%;aspect-ratio:16/9;object-fit:cover}article div{padding:19px}article small{color:#1768e6;font-weight:950;text-transform:uppercase}article h2{font-size:21px;margin:8px 0}article p{color:#5b7192;line-height:1.5}article span{font-weight:900;color:#1768e6}.empty{grid-column:1/-1;padding:70px;text-align:center}footer{text-align:center;padding:30px;background:#061c44;color:#c7daf7}@media(max-width:760px){nav a:not(:last-child){display:none}main section{grid-template-columns:1fr}}`;
const ARTICLE_CSS = `*{box-sizing:border-box}body{margin:0;background:#f5f9ff;color:#071f4b;font-family:Georgia,serif}header{height:68px;padding:0 max(18px,6vw);display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #d8e7f7}header a{font-family:Arial,sans-serif;font-weight:900;text-decoration:none}main{max-width:840px;margin:auto;padding:55px 20px 90px}main>small{font-family:Arial,sans-serif;color:#1768e6;font-weight:900}h1{font-size:clamp(38px,6vw,64px);line-height:1.04;margin:12px 0 18px}.summary{font-size:21px;color:#526987;line-height:1.55}.cover{width:100%;max-height:520px;object-fit:cover;border-radius:22px;margin:25px 0}article{font-size:19px;line-height:1.8}aside{margin-top:40px;padding:22px;background:#fff;border:1px solid #d8e7f7;border-radius:16px}aside a{color:#1768e6}.review{font-family:Arial,sans-serif;color:#6b7e98;font-size:12px;margin-top:25px}.products{margin-top:45px;padding-top:28px;border-top:1px solid #d8e7f7;font-family:Inter,Arial,sans-serif}.products-head{display:flex;align-items:end;justify-content:space-between;gap:15px}.products-head small{color:#1768e6;font-weight:950}.products-head h2{margin:5px 0}.products-head a{color:#1768e6;font-weight:900;text-decoration:none}.product-track{display:flex;gap:14px;margin-top:18px;padding-bottom:10px;overflow-x:auto;scroll-snap-type:x mandatory}.product-card{flex:0 0 210px;scroll-snap-align:start;overflow:hidden;border:1px solid #d8e7f7;border-radius:16px;background:#fff;color:#071f4b;text-decoration:none}.product-card img{width:100%;aspect-ratio:1/1;object-fit:cover}.product-card span,.product-card strong,.product-card b{display:block;margin:7px 13px}.product-card span{color:#617694;font-size:11px}.product-card strong{min-height:38px}.product-card b{color:#1768e6;font-size:18px;margin-bottom:14px}@media(max-width:600px){.products-head{align-items:start;flex-direction:column}.product-card{flex-basis:72vw}}`;

export function setupTrendRadar({
  app,
  db,
  requireAdmin,
  sameOriginOnly,
  publicPage,
  generateEditorialDraft,
  reviewEditorialDraft,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS trend_topics(id TEXT PRIMARY KEY,title TEXT NOT NULL UNIQUE,traffic TEXT NOT NULL DEFAULT '',published_at TEXT,portal TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',source_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS editorial_articles(id TEXT PRIMARY KEY,trend_id TEXT,slug TEXT NOT NULL UNIQUE,portal TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',body TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',sources_json TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'draft',published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS editorial_agent_reviews(id INTEGER PRIMARY KEY,article_id TEXT NOT NULL,agent_code TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(article_id,agent_code));
  CREATE TABLE IF NOT EXISTS editorial_automation_log(id INTEGER PRIMARY KEY,cycle_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,cycle_finished_at TEXT,status TEXT NOT NULL DEFAULT 'running',created_count INTEGER NOT NULL DEFAULT 0,published_count INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');`);

  db.prepare(`INSERT OR IGNORE INTO editorial_articles
    (id,slug,portal,title,summary,body,image_url,sources_json,status,published_at)
    VALUES (?,?,?,?,?,?,?,'[]','published',CURRENT_TIMESTAMP)`).run(
      "seed-guia-plantas-2026",
      "como-cuidar-de-plantas-em-casa-guia-pratico",
      "plantas-e-jardinagem",
      "Como cuidar de plantas em casa: guia prático para começar",
      "Aprenda a observar luz, rega, substrato, vasos e sinais das folhas para manter suas plantas saudáveis sem complicação.",
      `Uma planta saudável começa no lugar certo. Antes de pensar em adubo ou em uma rotina rígida de rega, observe quanta luz chega ao ambiente. Luz forte indireta, sol direto e sombra luminosa são condições diferentes. Aproximar uma planta de uma janela pode ajudar, mas algumas folhas queimam quando recebem sol intenso de repente. Faça mudanças graduais e acompanhe a resposta durante alguns dias.

A rega deve seguir a necessidade da planta e a umidade do substrato, não apenas o calendário. Coloque o dedo alguns centímetros na terra: se a camada ainda estiver úmida, espere. Quando chegar a hora, regue até a água começar a sair pelos furos do vaso e descarte o excesso do prato. Manter raízes constantemente encharcadas reduz a entrada de oxigênio e favorece problemas. Folhas murchas podem indicar falta ou excesso de água, por isso a terra precisa ser examinada antes da próxima rega.

O vaso precisa ter drenagem. Recipientes decorativos sem furos podem ser usados como cachepô, mantendo dentro deles um vaso próprio para cultivo. O tamanho também importa: um recipiente grande demais conserva umidade por muito tempo, enquanto um vaso pequeno pode limitar raízes e secar rapidamente. Ao trocar a planta, aumente apenas um pouco o diâmetro e preserve o torrão quando as raízes estiverem saudáveis.

Substrato não é apenas terra comum. Uma boa mistura precisa sustentar a planta, guardar parte da umidade e permitir circulação de ar. A composição muda conforme a espécie: suculentas costumam exigir drenagem rápida, enquanto plantas tropicais podem preferir umidade mais constante. Produtos específicos ajudam, mas a escolha deve considerar o ambiente, o vaso e a frequência real de rega.

Adubo complementa o cultivo; ele não corrige falta de luz, excesso de água ou raízes doentes. Leia o rótulo, respeite a dose e evite aplicar mais produto esperando crescimento mais rápido. Em muitos casos, uma dose menor e regular é mais segura. Plantas recém-transplantadas, enfraquecidas ou com sinais de apodrecimento devem ser estabilizadas antes de receber adubação.

As folhas contam o que está acontecendo. Pontas secas podem estar ligadas a baixa umidade, acúmulo de sais ou rega irregular. Amarelamento pode surgir pelo envelhecimento natural de folhas inferiores, mas também por excesso de água. Manchas que aumentam, presença de teias ou pequenos insetos merecem isolamento e inspeção. Limpe as folhas com cuidado e examine o verso, onde muitas pragas se escondem.

Crie uma rotina simples: observe as plantas uma ou duas vezes por semana, gire os vasos para equilibrar o crescimento e retire somente folhas totalmente secas ou doentes. Registre mudanças de lugar, regas e adubações quando estiver aprendendo. Esse histórico ajuda a descobrir o que funciona no seu ambiente, porque temperatura, vento e luminosidade variam de uma casa para outra.

Comece com poucas espécies e aprenda o ritmo de cada uma. O objetivo não é seguir uma fórmula perfeita, mas perceber sinais cedo e ajustar o cuidado. Com luz adequada, drenagem, rega consciente e observação frequente, a maior parte dos problemas pode ser evitada antes de comprometer a planta.`,
      "/assets/agrotecnica-premium-v2.webp",
    );
  db.prepare(`INSERT OR IGNORE INTO trend_topics
    (id,title,traffic,published_at,portal,status,source_url)
    VALUES (?,?,?,?,?,'new',?)`).run(
      "owned-social-plant-care-guide",
      "Guia prático de cuidados com plantas em casa",
      "tema validado por vídeos próprios com alto engajamento",
      new Date().toISOString(),
      "plantas-e-jardinagem",
      "https://vitrinecity.com/plantas-e-jardinagem",
    );

  const editorialPortals = [
    "noticias",
    "esportes",
    "receitas",
    "plantas-e-jardinagem",
    "tecnologia",
    "inteligencia-artificial",
    "entretenimento",
  ];
  let automationRunning = false;
  async function syncTrendFeed() {
    const response = await fetch(
      "https://trends.google.com/trending/rss?geo=BR",
      {
        headers: { "user-agent": "VitrineCity Editorial Radar/1.0" },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Google Trends indisponível");
    const items = [
      ...(await response.text()).matchAll(/<item>([\s\S]*?)<\/item>/g),
    ].map((match) => match[1]);
    const insert = db.prepare(
      `INSERT INTO trend_topics(id,title,traffic,published_at,portal,status,source_url) VALUES(?,?,?,?,?,'new',?) ON CONFLICT(title) DO UPDATE SET traffic=excluded.traffic,published_at=excluded.published_at,updated_at=CURRENT_TIMESTAMP`,
    );
    for (const item of items) {
      const title = tag(item, "title");
      if (title)
        insert.run(
          randomUUID(),
          title,
          tag(item, "ht:approx_traffic"),
          tag(item, "pubDate"),
          portalFor(title),
          tag(item, "link"),
        );
    }
    return items.length;
  }
  async function createAutomatedArticle(trend) {
    const generated = await generateEditorialDraft({
      title: trend.title,
      portal: trend.portal,
      traffic: trend.traffic,
      sourceUrl: trend.source_url,
    });
    const articleId = randomUUID(),
      title = String(generated.title || trend.title)
        .trim()
        .slice(0, 180),
      body = String(generated.body || "").trim();
    const summary = String(generated.summary || "").trim(),
      imageUrl = String(generated.imageUrl || "");
    const sources = trend.source_url
      ? [{ title: "Google Trends — tendência identificada", url: trend.source_url }]
      : [];
    let director = { approved: false, requiresSources: true, risk: "high", notes: "Diretoria indisponível." };
    try {
      director = await reviewEditorialDraft({ title, summary, body, portal: trend.portal, imageUrl, sources });
    } catch (error) {
      director.notes = `Falha na revisão da Diretoria: ${String(error.message || error).slice(0, 500)}`;
    }
    const sourceOk = director.approved && (!director.requiresSources || sources.length >= 2);
    const reviews = [
      [
        "redacao",
        body.length >= 600 && summary.length >= 40,
        `Texto: ${body.length} caracteres; resumo: ${summary.length}.`,
      ],
      [
        "fontes",
        sourceOk,
        sourceOk
          ? "Duas ou mais fontes independentes verificadas."
          : "Google Trends identifica interesse, mas não comprova os fatos; exige fontes independentes.",
      ],
      [
        "midia",
        imageUrl.length > 0 && imageUrl !== "/assets/vitriny-city-master.jpg",
        imageUrl ? "Capa verificada." : "Capa ausente.",
      ],
      [
        "editora",
        body.length >= 600 &&
          summary.length >= 40 &&
          sourceOk && director.approved &&
          imageUrl.length > 0 &&
          imageUrl !== "/assets/vitriny-city-master.jpg",
        "Validação final do Coordenador da Editora.",
      ],
      [
        "diretoria",
        director.approved && sourceOk,
        `Risco: ${director.risk}. ${director.notes}`,
      ],
    ];
    const approved = reviews.every(([, ok]) => ok);
    db.prepare(
      `INSERT INTO editorial_articles(id,trend_id,slug,portal,title,summary,body,image_url,sources_json,status,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    ).run(
      articleId,
      trend.id,
      slugify(title) + "-" + Date.now().toString(36),
      trend.portal,
      title,
      summary,
      body,
      imageUrl || "/assets/vitriny-city-master.jpg",
      JSON.stringify(sources),
      approved ? "published" : "draft",
      approved ? 1 : 0,
    );
    const saveReview = db.prepare(
      `INSERT INTO editorial_agent_reviews(article_id,agent_code,approved,notes) VALUES(?,?,?,?) ON CONFLICT(article_id,agent_code) DO UPDATE SET approved=excluded.approved,notes=excluded.notes,created_at=CURRENT_TIMESTAMP`,
    );
    for (const [agent, ok, notes] of reviews)
      saveReview.run(articleId, agent, ok ? 1 : 0, notes);
    db.prepare(
      "UPDATE trend_topics SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(approved ? "published" : "drafted", trend.id);
    return approved;
  }
  async function runEditorialAutomation() {
    if (
      automationRunning ||
      process.env.EDITORIAL_AUTOMATION_ENABLED === "false"
    )
      return;
    automationRunning = true;
    const log = db
      .prepare("INSERT INTO editorial_automation_log(status) VALUES('running')")
      .run();
    let created = 0,
      published = 0;
    try {
      await syncTrendFeed();
      for (const portal of editorialPortals) {
        const today = Number(
          db
            .prepare(
              "SELECT COUNT(*) total FROM editorial_articles WHERE portal=? AND status='published' AND date(published_at)=date('now')",
            )
            .get(portal).total || 0,
        );
        if (today >= 3) continue;
        const trend = db
          .prepare(
            "SELECT * FROM trend_topics WHERE portal=? AND status='new' ORDER BY published_at DESC,created_at DESC LIMIT 1",
          )
          .get(portal);
        if (!trend) continue;
        db.prepare(
          "UPDATE trend_topics SET status='generating',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(trend.id);
        try {
          const ok = await createAutomatedArticle(trend);
          created++;
          if (ok) published++;
        } catch (error) {
          db.prepare(
            "UPDATE trend_topics SET status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          ).run(trend.id);
          console.error(
            "Editorial automation item failed",
            String(error.message || error),
          );
        }
      }
      db.prepare(
        "UPDATE editorial_automation_log SET status='completed',cycle_finished_at=CURRENT_TIMESTAMP,created_count=?,published_count=? WHERE id=?",
      ).run(created, published, log.lastInsertRowid);
    } catch (error) {
      db.prepare(
        "UPDATE editorial_automation_log SET status='failed',cycle_finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?",
      ).run(String(error.message || error).slice(0, 500), log.lastInsertRowid);
    } finally {
      automationRunning = false;
    }
  }
  setTimeout(runEditorialAutomation, 60_000).unref();
  setInterval(runEditorialAutomation, 2 * 60 * 60 * 1000).unref();
  app.get(
    "/admin-tendencias.html",
    requireAdmin,
    publicPage("admin-tendencias.html"),
  );
  app.get("/api/admin/trends", requireAdmin, (_req, res) =>
    res.json({
      topics: db
        .prepare(
          "SELECT * FROM trend_topics ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      articles: db
        .prepare(
          "SELECT * FROM editorial_articles ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      automation:
        db
          .prepare(
            "SELECT * FROM editorial_automation_log ORDER BY id DESC LIMIT 1",
          )
          .get() || null,
      reviews: db
        .prepare(
          "SELECT * FROM editorial_agent_reviews ORDER BY id DESC LIMIT 200",
        )
        .all(),
    }),
  );
  app.post(
    "/api/admin/trends/sync",
    requireAdmin,
    sameOriginOnly,
    async (_req, res) => {
      try {
        const response = await fetch(
          "https://trends.google.com/trending/rss?geo=BR",
          {
            headers: { "user-agent": "VitrineCity Editorial Radar/1.0" },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) throw new Error("Google Trends indisponível");
        const xml = await response.text(),
          items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(
            (m) => m[1],
          );
        const insert = db.prepare(
          `INSERT INTO trend_topics(id,title,traffic,published_at,portal,status,source_url) VALUES(?,?,?,?,?,'new',?) ON CONFLICT(title) DO UPDATE SET traffic=excluded.traffic,published_at=excluded.published_at,updated_at=CURRENT_TIMESTAMP`,
        );
        let count = 0;
        for (const item of items) {
          const title = tag(item, "title");
          if (!title) continue;
          insert.run(
            randomUUID(),
            title,
            tag(item, "ht:approx_traffic"),
            tag(item, "pubDate"),
            portalFor(title),
            tag(item, "link"),
          );
          count++;
        }
        return res.json({ ok: true, count });
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    },
  );
  app.post(
    "/api/admin/trends/:id/draft",
    requireAdmin,
    sameOriginOnly,
    async (req, res) => {
      const trend = db
        .prepare("SELECT * FROM trend_topics WHERE id=?")
        .get(req.params.id);
      if (!trend)
        return res.status(404).json({ error: "Tendência não encontrada." });
      const portal = [
        "noticias",
        "esportes",
        "receitas",
        "tecnologia",
        "inteligencia-artificial",
        "entretenimento",
      ].includes(req.body?.portal)
        ? req.body.portal
        : trend.portal;
      try {
        db.prepare(
          "UPDATE trend_topics SET status='generating',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(trend.id);
        const generated = await generateEditorialDraft({
          title: String(req.body?.title || trend.title)
            .trim()
            .slice(0, 180),
          portal,
          traffic: trend.traffic,
          sourceUrl: trend.source_url,
        });
        const title = String(generated.title || trend.title)
            .trim()
            .slice(0, 180),
          slug = slugify(title) + "-" + Date.now().toString(36);
        const body = String(generated.body || "").trim();
        if (body.length < 600)
          throw new Error(
            "O agente não produziu o mínimo de 600 caracteres. Tente novamente.",
          );
        const sources = trend.source_url
          ? [
              {
                title: "Google Trends — tendência identificada",
                url: trend.source_url,
              },
            ]
          : [];
        db.prepare(
          `INSERT INTO editorial_articles(id,trend_id,slug,portal,title,summary,body,image_url,sources_json,status) VALUES(?,?,?,?,?,?,?,?,?,'draft')`,
        ).run(
          randomUUID(),
          trend.id,
          slug,
          portal,
          title,
          String(generated.summary || "").trim(),
          body,
          String(generated.imageUrl || "/assets/vitriny-city-master.jpg"),
          JSON.stringify(sources),
        );
        db.prepare(
          "UPDATE trend_topics SET status='drafted',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(trend.id);
        return res.json({
          ok: true,
          slug,
          characters: body.length,
          imageUrl: generated.imageUrl,
        });
      } catch (error) {
        db.prepare(
          "UPDATE trend_topics SET status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(trend.id);
        return res.status(error.status || 502).json({
          error: error.message || "Não foi possível criar o rascunho.",
        });
      }
    },
  );
  app.patch(
    "/api/admin/articles/:id",
    requireAdmin,
    sameOriginOnly,
    (req, res) => {
      const current = db
        .prepare("SELECT * FROM editorial_articles WHERE id=?")
        .get(req.params.id);
      if (!current)
        return res.status(404).json({ error: "Artigo não encontrado." });
      const body = req.body || {};
      db.prepare(
        `UPDATE editorial_articles SET portal=?,title=?,summary=?,body=?,image_url=?,sources_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).run(
        [
          "noticias",
          "esportes",
          "receitas",
          "plantas-e-jardinagem",
          "tecnologia",
          "inteligencia-artificial",
          "entretenimento",
        ].includes(body.portal)
          ? body.portal
          : current.portal,
        String(body.title || current.title)
          .trim()
          .slice(0, 180),
        String(body.summary ?? current.summary)
          .trim()
          .slice(0, 500),
        String(body.body ?? current.body)
          .trim()
          .slice(0, 20000),
        String(body.imageUrl ?? current.image_url)
          .trim()
          .slice(0, 1000),
        JSON.stringify(
          Array.isArray(body.sources)
            ? body.sources.slice(0, 12)
            : JSON.parse(current.sources_json || "[]"),
        ),
        current.id,
      );
      return res.json({ ok: true });
    },
  );
  app.post(
    "/api/admin/articles/:id/publish",
    requireAdmin,
    sameOriginOnly,
    (req, res) => {
      const result = db
        .prepare(
          "UPDATE editorial_articles SET status='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND LENGTH(body)>=600 AND LENGTH(summary)>=40 AND LENGTH(image_url)>0",
        )
        .run(req.params.id);
      if (!result.changes)
        return res.status(409).json({
          error:
            "Revise o resumo, a imagem e garanta pelo menos 600 caracteres antes de publicar.",
        });
      return res.json({ ok: true });
    },
  );
  for (const portal of [
    "conteudo",
    "noticias",
    "esportes",
    "receitas",
    "plantas-e-jardinagem",
    "tecnologia",
    "inteligencia-artificial",
    "entretenimento",
  ])
    app.get("/" + portal, (_req, res) => {
      const rows =
        portal === "conteudo"
          ? db
              .prepare(
                "SELECT * FROM editorial_articles WHERE status='published' ORDER BY published_at DESC LIMIT 60",
              )
              .all()
          : db
              .prepare(
                "SELECT * FROM editorial_articles WHERE status='published' AND portal=? ORDER BY published_at DESC LIMIT 60",
              )
              .all(portal);
      res.type("html").send(renderIndex(portal, rows));
    });
  app.get("/artigo/:slug", (req, res) => {
    const row = db
      .prepare(
        "SELECT * FROM editorial_articles WHERE slug=? AND status='published'",
      )
      .get(req.params.slug);
    if (!row) return res.status(404).send("Artigo não encontrado.");
    const contextTerms = row.portal === 'receitas' ? /cozinha|panela|forma|alimento|tempero|receita/ : row.portal === 'plantas-e-jardinagem' ? /planta|adubo|terra|substrato|vaso|jardin|semente|npk/ : null;
    const products = db.prepare(`SELECT p.id,p.name,p.category,p.price_cents,p.image_url,s.business_name store_name FROM store_products p JOIN store_profiles s ON s.order_reference=p.store_reference WHERE p.active=1 AND p.marketplace_enabled=1 AND p.price_cents>0 AND p.stock_quantity>0 AND s.review_status='published' ORDER BY p.updated_at DESC,p.id DESC LIMIT 40`).all().sort((a,b)=>Number(contextTerms?.test(`${b.name} ${b.category}`.toLowerCase()))-Number(contextTerms?.test(`${a.name} ${a.category}`.toLowerCase()))).slice(0,10);
    return res.type("html").send(renderArticle(row, products));
  });
}
