import { randomUUID } from "node:crypto";

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const slugify = (v) =>
  String(v || "livro")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
const bookCategory = (value) => {
  const text = String(value || "").toLowerCase();
  if (/romance|fic/.test(text)) return "romance ficcional";
  if (/tecnologia/.test(text)) return "tecnologia";
  if (/intelig.ncia artificial|\bia\b/.test(text))
    return "inteligência artificial";
  if (/finan|econom|dinheiro|sal.rio/.test(text))
    return "finanças pessoais educativas";
  if (/prosper/.test(text)) return "prosperidade responsável";
  return "desenvolvimento pessoal";
};

function landing(book, chapters) {
  const sample =
    chapters[0]?.content?.slice(0, 1800) ||
    "A amostra será disponibilizada após a revisão editorial.";
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    description: book.summary,
    image: new URL(book.cover_url, "https://vitrinecity.com").href,
    author: { "@type": "Organization", name: "Editora Digital VitrineCity" },
    offers: {
      "@type": "Offer",
      price: "9.99",
      priceCurrency: "BRL",
      availability: "https://schema.org/InStock",
      url: `https://vitrinecity.com/livro/${book.slug}`,
    },
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)} — Editora VitrineCity</title><meta name="description" content="${esc(book.summary)}"><link rel="canonical" href="https://vitrinecity.com/livro/${esc(book.slug)}"><meta property="og:title" content="${esc(book.title)}"><meta property="og:description" content="${esc(book.summary)}"><meta property="og:image" content="${esc(book.cover_url)}"><script type="application/ld+json">${schema}</script><style>${CSS}</style></head><body><header><a href="/">VitrineCity</a><a href="/livros">Editora Digital</a></header><main><img class="cover" src="${esc(book.cover_url)}" alt="Capa de ${esc(book.title)}"><section><small>${esc(book.category)} · LIVRO DIGITAL</small><h1>${esc(book.title)}</h1><p class="lead">${esc(book.summary)}</p><div class="price">R$ 9,99</div><a class="buy" href="/centro-educacional.html#livro-${esc(book.slug)}">Comprar e acessar</a><p>${esc(book.audience)}</p><h2>Você encontrará</h2><ol>${chapters.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ol><h2>Amostra</h2><p class="sample">${esc(sample)}</p></section></main></body></html>`;
}
function reader(book, chapters, back = "/meus-cursos.html") {
  const body = chapters
    .map(
      (c) =>
        `<article><small>CAPÍTULO ${c.position}</small><h2>${esc(c.title)}</h2>${c.image_url ? `<img src="${esc(c.image_url)}" alt="Ilustração do capítulo">` : ""}${String(
          c.content || "",
        )
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((p) => `<p>${esc(p)}</p>`)
          .join("")}</article>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)} — Leitor</title><style>*{box-sizing:border-box}body{margin:0;background:#e8edf4;color:#17243a;font-family:Georgia,serif}header{position:sticky;top:0;height:64px;padding:0 5vw;display:flex;align-items:center;justify-content:space-between;background:#071f4b;color:#fff;z-index:2}header a{color:#fff}.book{max-width:800px;margin:25px auto}.cover,article{margin:22px 10px;padding:65px 70px;min-height:980px;background:#fff;box-shadow:0 8px 25px #17304f22}.cover{text-align:center}.cover img{max-width:320px;max-height:480px}.cover h1{font-size:46px}article h2{font-size:36px}article img{width:100%;max-height:380px;object-fit:cover;margin:20px 0}article p{font-size:18px;line-height:1.8;text-align:justify}@media(max-width:650px){.cover,article{padding:32px 22px;min-height:auto}.cover h1{font-size:34px}}</style></head><body><header><a href="${esc(back)}">← Voltar</a><b>${esc(book.title)}</b></header><main class="book"><section class="cover"><img src="${esc(book.cover_url)}"><h1>${esc(book.title)}</h1><p>Editora Digital VitrineCity</p></section>${body}</main></body></html>`;
}
const CSS = `*{box-sizing:border-box}body{margin:0;background:#f4f8ff;color:#071f4b;font-family:Inter,Arial,sans-serif}header{height:70px;padding:0 max(18px,6vw);display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #d7e4f5}header a{font-weight:900;text-decoration:none}main{max-width:1050px;margin:50px auto;padding:20px;display:grid;grid-template-columns:340px 1fr;gap:50px}.cover{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:18px;box-shadow:0 20px 50px #173a6d30}small{color:#1768e6;font-weight:950}h1{font-size:clamp(38px,6vw,65px);line-height:1.03;margin:12px 0}.lead,.sample{font-size:18px;line-height:1.7;color:#536b8c}.price{font-size:35px;font-weight:950;margin:20px 0}.buy{display:inline-block;padding:15px 20px;border-radius:12px;background:#1768e6;color:#fff;text-decoration:none;font-weight:950}li{margin:9px 0}@media(max-width:760px){main{grid-template-columns:1fr}.cover{max-width:310px;margin:auto}}`;

export function setupDigitalPublisher({
  app,
  db,
  requireAdmin,
  requireUser,
  sameOriginOnly,
  activeEnrollment,
  generateBookPlan,
  generateBookChapter,
  generateBookCover,
  generateBookIllustration,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS digital_books(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,category TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',audience TEXT NOT NULL DEFAULT '',keywords_json TEXT NOT NULL DEFAULT '[]',cover_url TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'planning',word_count INTEGER NOT NULL DEFAULT 0,page_count INTEGER NOT NULL DEFAULT 0,price_cents INTEGER NOT NULL DEFAULT 999,source_trend_id TEXT,review_notes TEXT NOT NULL DEFAULT '',published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS digital_book_chapters(id INTEGER PRIMARY KEY,book_id TEXT NOT NULL,position INTEGER NOT NULL,title TEXT NOT NULL,brief TEXT NOT NULL DEFAULT '',content TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(book_id,position));
  CREATE TABLE IF NOT EXISTS digital_book_reviews(id INTEGER PRIMARY KEY,book_id TEXT NOT NULL,agent_code TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(book_id,agent_code));`);
  if (
    !db
      .prepare("PRAGMA table_info(digital_book_chapters)")
      .all()
      .some((c) => c.name === "image_url")
  )
    db.exec(
      "ALTER TABLE digital_book_chapters ADD COLUMN image_url TEXT NOT NULL DEFAULT ''",
    );
  const book = (id) =>
    db.prepare("SELECT * FROM digital_books WHERE id=? OR slug=?").get(id, id);
  const chapters = (id) =>
    db
      .prepare(
        "SELECT * FROM digital_book_chapters WHERE book_id=? ORDER BY position",
      )
      .all(id);
  app.get("/admin-editora.html", requireAdmin, (_q, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editora Digital — Administração</title><style>${CSS}.admin{max-width:1200px;margin:35px auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:#fff;padding:18px;border-radius:16px}.bar{height:8px;background:#dbe8fa;border-radius:8px}.bar i{display:block;height:100%;background:#1768e6;border-radius:8px}button{padding:11px;border:0;border-radius:9px;background:#1768e6;color:#fff;font-weight:900}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body><header><b>Editora Digital VitrineCity</b><a href="/admin.html">Voltar ao painel</a></header><main class="admin"><h1>Produção de livros</h1><p>Até dois projetos por dia. Publicação somente com 30 páginas, 9.000 palavras, dez capítulos e capa.</p><div id="list" class="grid"></div></main><script>const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){const r=await fetch('/api/admin/books');if(r.status===401)return location.href='/admin-login.html';const d=await r.json();list.innerHTML=d.items.map(b=>'<article class="card"><small>'+e(b.status)+'</small><h2>'+e(b.title)+'</h2><p>'+e(b.category)+'</p><div class="bar"><i style="width:'+Math.min(100,b.page_count/30*100)+'%"></i></div><p>'+b.page_count+'/30 páginas · '+b.word_count+' palavras</p>'+(b.status==='review'?'<button data-id="'+b.id+'">Aprovar e publicar</button>':'')+'</article>').join('')||'<p>A automação criará os primeiros projetos a partir das tendências.</p>'}list.onclick=async ev=>{const b=ev.target.closest('button');if(!b)return;const r=await fetch('/api/admin/books/'+b.dataset.id+'/publish',{method:'POST'}),d=await r.json();alert(r.ok?'Livro publicado.':d.error);load()};load()</script></body></html>`,
      ),
  );
  app.get("/api/admin/books", requireAdmin, (_q, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM digital_books ORDER BY created_at DESC")
        .all(),
    }),
  );
  app.get("/admin-livro.html", requireAdmin, (_q, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisar livro — VitrineCity</title><style>${CSS}.editor{max-width:1050px;margin:30px auto;padding:20px}.panel{background:#fff;padding:20px;border-radius:16px;margin:15px 0}input,textarea,select{width:100%;padding:11px;margin:5px 0 12px;border:1px solid #cbdcf1;border-radius:9px}textarea{min-height:120px}.chapter textarea{min-height:430px}button{padding:12px 16px;border:0;border-radius:10px;background:#1768e6;color:#fff;font-weight:900;cursor:pointer}.meta{color:#617694}</style></head><body><header><a href="/admin-editora.html">← Editora Digital</a><b>Revisão do livro</b></header><main class="editor"><div id="status"></div><form id="book" class="panel"><h1 id="heading">Carregando…</h1><label>Título<input name="title"></label><label>Categoria<select name="category"><option>desenvolvimento pessoal</option><option>finanças pessoais educativas</option><option>tecnologia</option><option>inteligência artificial</option><option>romance ficcional</option><option>prosperidade responsável</option></select></label><label>Resumo<textarea name="summary"></textarea></label><label>Público<textarea name="audience"></textarea></label><label>URL da capa<input name="coverUrl"></label><button>Salvar dados do livro</button> <button id="publish" type="button">Aprovar e publicar</button></form><section id="chapters"></section></main><script>const id=new URLSearchParams(location.search).get('id');let currentId=id;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){if(!currentId){const r=await fetch('/api/admin/books'),d=await r.json();currentId=d.items.find(x=>x.status==='review')?.id||d.items[0]?.id;if(!currentId){status.textContent='Nenhum livro disponível.';return}}const r=await fetch('/api/admin/books/'+currentId);if(r.status===401)return location.href='/admin-login.html';const d=await r.json(),b=d.item;heading.textContent=b.title;for(const n of ['title','category','summary','audience'])book.elements[n].value=b[n]||'';book.elements.coverUrl.value=b.cover_url||'';status.textContent=b.page_count+' páginas · '+b.word_count+' palavras · '+b.status;chapters.innerHTML=d.chapters.map(c=>'<form class="panel chapter" data-position="'+c.position+'"><h2>Capítulo '+c.position+'</h2><input name="title" value="'+esc(c.title)+'"><textarea name="content">'+esc(c.content)+'</textarea><button>Salvar capítulo</button></form>').join('')}book.onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(book));const r=await fetch('/api/admin/books/'+currentId,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();status.textContent=r.ok?'Livro salvo e mantido em revisão.':d.error;load()};chapters.onsubmit=async e=>{e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));const r=await fetch('/api/admin/books/'+currentId+'/chapters/'+f.dataset.position,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),d=await r.json();status.textContent=r.ok?'Capítulo salvo.':d.error;load()};publish.onclick=async()=>{if(!confirm('Aprovar este livro e colocá-lo à venda por R$ 9,99?'))return;const r=await fetch('/api/admin/books/'+currentId+'/publish',{method:'POST'}),d=await r.json();status.textContent=r.ok?'Livro publicado: '+d.url:d.error};load()</script></body></html>`,
      ),
  );
  app.get("/api/admin/books/:id", requireAdmin, (req, res) => {
    const item = book(req.params.id);
    if (!item) return res.status(404).json({ error: "Livro não encontrado." });
    res.json({
      item,
      chapters: chapters(item.id),
      reviews: db
        .prepare("SELECT * FROM digital_book_reviews WHERE book_id=?")
        .all(item.id),
    });
  });
  app.get("/admin-livro-preview.html", requireAdmin, (req, res) => {
    const item = req.query.id
      ? book(String(req.query.id))
      : db
          .prepare(
            "SELECT * FROM digital_books WHERE status IN ('review','published') ORDER BY updated_at DESC LIMIT 1",
          )
          .get();
    if (!item) return res.status(404).send("Livro não encontrado.");
    res
      .type("html")
      .send(
        reader(
          item,
          chapters(item.id),
          "/admin-livro.html?id=" + encodeURIComponent(item.id),
        ),
      );
  });
  app.patch(
    "/api/admin/books/:id",
    requireAdmin,
    sameOriginOnly,
    (req, res) => {
      const item = book(req.params.id);
      if (!item)
        return res.status(404).json({ error: "Livro não encontrado." });
      const body = req.body || {},
        title = String(body.title ?? item.title)
          .trim()
          .slice(0, 180),
        category = bookCategory(body.category ?? item.category),
        summary = String(body.summary ?? item.summary)
          .trim()
          .slice(0, 2000),
        audience = String(body.audience ?? item.audience)
          .trim()
          .slice(0, 800),
        cover = String(body.coverUrl ?? item.cover_url)
          .trim()
          .slice(0, 1000);
      if (title.length < 3 || summary.length < 40)
        return res
          .status(400)
          .json({ error: "Informe título e resumo completos." });
      db.prepare(
        "UPDATE digital_books SET title=?,category=?,summary=?,audience=?,cover_url=?,status=CASE WHEN status='published' THEN 'review' ELSE status END,published_at=CASE WHEN status='published' THEN NULL ELSE published_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(title, category, summary, audience, cover, item.id);
      db.prepare(
        "UPDATE managed_courses SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE slug=?",
      ).run(`livro-${item.slug}`);
      res.json({ ok: true, item: book(item.id) });
    },
  );
  app.patch(
    "/api/admin/books/:id/chapters/:position",
    requireAdmin,
    sameOriginOnly,
    (req, res) => {
      const item = book(req.params.id),
        position = Number(req.params.position);
      if (!item)
        return res.status(404).json({ error: "Livro não encontrado." });
      const current = db
        .prepare(
          "SELECT * FROM digital_book_chapters WHERE book_id=? AND position=?",
        )
        .get(item.id, position);
      if (!current)
        return res.status(404).json({ error: "Capítulo não encontrado." });
      const title = String(req.body?.title ?? current.title)
          .trim()
          .slice(0, 180),
        content = String(req.body?.content ?? current.content)
          .trim()
          .slice(0, 100000),
        words = content ? content.split(/\s+/).length : 0;
      if (title.length < 3 || words < 300)
        return res
          .status(400)
          .json({
            error: "O capítulo precisa de título e pelo menos 300 palavras.",
          });
      db.prepare(
        "UPDATE digital_book_chapters SET title=?,content=?,status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(title, content, current.id);
      const total = db
        .prepare(
          "SELECT COALESCE(SUM(LENGTH(content)-LENGTH(REPLACE(content,' ',''))+1),0) words FROM digital_book_chapters WHERE book_id=?",
        )
        .get(item.id);
      db.prepare(
        "UPDATE digital_books SET word_count=?,page_count=?,status='review',published_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(total.words, Math.floor(total.words / 300), item.id);
      db.prepare(
        "UPDATE managed_courses SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE slug=?",
      ).run(`livro-${item.slug}`);
      res.json({
        ok: true,
        words,
        totalWords: total.words,
        pages: Math.floor(total.words / 300),
      });
    },
  );
  app.post(
    "/api/admin/books/:id/publish",
    requireAdmin,
    sameOriginOnly,
    (req, res) => {
      const item = book(req.params.id);
      if (!item)
        return res.status(404).json({ error: "Livro não encontrado." });
      if (
        item.word_count < 9000 ||
        item.page_count < 30 ||
        chapters(item.id).filter((c) => c.status === "approved").length < 10 ||
        !item.cover_url
      )
        return res.status(409).json({
          error:
            "O livro precisa de 30 páginas, 9.000 palavras, 10 capítulos aprovados e capa.",
        });
      db.prepare(
        "UPDATE digital_books SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(item.id);
      db.prepare(
        `INSERT INTO managed_courses(slug,title,description,audience,price_cents,modules,cover_url,material_url,status) VALUES(?,?,?,?,999,1,?,?,'active') ON CONFLICT(slug) DO UPDATE SET title=excluded.title,description=excluded.description,audience=excluded.audience,price_cents=999,cover_url=excluded.cover_url,material_url=excluded.material_url,status='active',updated_at=CURRENT_TIMESTAMP`,
      ).run(
        `livro-${item.slug}`,
        item.title,
        item.summary,
        item.audience,
        item.cover_url,
        `/ler-livro/${item.slug}`,
      );
      res.json({ ok: true, url: `/livro/${item.slug}` });
    },
  );
  app.get("/livros", (_q, res) => {
    const items = db
      .prepare(
        "SELECT * FROM digital_books WHERE status='published' ORDER BY published_at DESC",
      )
      .all();
    res
      .type("html")
      .send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editora Digital VitrineCity</title><style>${CSS}main{display:grid;grid-template-columns:repeat(3,1fr)}article img{width:100%;aspect-ratio:2/3;object-fit:cover}article{background:#fff;padding:18px;border-radius:18px} @media(max-width:760px){main{grid-template-columns:1fr}}</style></head><body><header><a href="/">VitrineCity</a><b>Editora Digital</b></header><main>${items.map((i) => `<article><a href="/livro/${esc(i.slug)}"><img src="${esc(i.cover_url)}"><h2>${esc(i.title)}</h2><p>${esc(i.summary)}</p><b>R$ 9,99</b></a></article>`).join("") || "<p>Os primeiros livros estão em produção.</p>"}</main></body></html>`,
      );
  });
  app.get("/livro/:slug", (req, res) => {
    const item = db
      .prepare(
        "SELECT * FROM digital_books WHERE slug=? AND status='published'",
      )
      .get(req.params.slug);
    if (!item) return res.status(404).send("Livro não encontrado.");
    res.type("html").send(landing(item, chapters(item.id)));
  });
  app.get("/api/my-courses/:slug/book", requireUser, (req, res) => {
    const slug = String(req.params.slug);
    if (!slug.startsWith("livro-") || !activeEnrollment(req.user.id, slug))
      return res.status(403).json({ error: "Acesso não autorizado." });
    const item = db
      .prepare(
        "SELECT * FROM digital_books WHERE slug=? AND status='published'",
      )
      .get(slug.slice(6));
    if (!item) return res.status(404).json({ error: "Livro não encontrado." });
    res.json({
      book: item,
      chapters: chapters(item.id).map(({ position, title, content }) => ({
        position,
        title,
        content,
      })),
    });
  });
  app.get("/ler-livro/:slug", requireUser, (req, res) => {
    const courseSlug = `livro-${req.params.slug}`;
    if (!activeEnrollment(req.user.id, courseSlug))
      return res.status(403).send("Acesso não autorizado.");
    const item = db
      .prepare(
        "SELECT * FROM digital_books WHERE slug=? AND status='published'",
      )
      .get(req.params.slug);
    if (!item) return res.status(404).send("Livro não encontrado.");
    res.type("html").send(reader(item, chapters(item.id)));
  });
  let running = false;
  async function worker() {
    if (running || process.env.BOOK_AUTOMATION_ENABLED === "false") return;
    running = true;
    try {
      const today = Number(
        db
          .prepare(
            "SELECT COUNT(*) n FROM digital_books WHERE date(created_at)=date('now')",
          )
          .get().n || 0,
      );
      if (today < 2) {
        const trend = db
          .prepare(
            "SELECT * FROM trend_topics WHERE status IN ('new','drafted') AND lower(title) NOT LIKE '%crime%' AND lower(title) NOT LIKE '%morte%' AND lower(title) NOT LIKE '%assassin%' AND lower(title) NOT LIKE '%violência%' AND id NOT IN (SELECT COALESCE(source_trend_id,'') FROM digital_books) ORDER BY published_at DESC LIMIT 1",
          )
          .get();
        if (trend) {
          const plan = await generateBookPlan(trend);
          const id = randomUUID(),
            slug = slugify(plan.title) + "-" + Date.now().toString(36);
          db.prepare(
            "INSERT INTO digital_books(id,slug,title,category,summary,audience,keywords_json,source_trend_id,status) VALUES(?,?,?,?,?,?,?,?,'writing')",
          ).run(
            id,
            slug,
            plan.title,
            bookCategory(plan.category),
            plan.summary,
            plan.audience,
            JSON.stringify(plan.keywords || []),
            trend.id,
          );
          const insert = db.prepare(
            "INSERT INTO digital_book_chapters(book_id,position,title,brief) VALUES(?,?,?,?)",
          );
          for (const [i, c] of plan.chapters.slice(0, 10).entries())
            insert.run(id, i + 1, c.title, c.brief || "");
        }
      }
      const pending = db
        .prepare(
          "SELECT c.*,b.title book_title,b.category,b.summary FROM digital_book_chapters c JOIN digital_books b ON b.id=c.book_id WHERE c.status='pending' AND b.status='writing' ORDER BY b.created_at,c.position LIMIT 2",
        )
        .all();
      for (const chapter of pending) {
        const content = await generateBookChapter(chapter);
        const words = String(content).trim().split(/\s+/).length;
        if (words < 700) continue;
        db.prepare(
          "UPDATE digital_book_chapters SET content=?,status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(content, chapter.id);
        const totals = db
          .prepare(
            "SELECT COUNT(*) chapters,SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved,SUM(LENGTH(content)-LENGTH(REPLACE(content,' ',''))+1) words FROM digital_book_chapters WHERE book_id=?",
          )
          .get(chapter.book_id);
        db.prepare(
          "UPDATE digital_books SET word_count=?,page_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(totals.words, Math.floor(totals.words / 300), chapter.book_id);
        if (totals.approved >= 10 && totals.words >= 9000) {
          const b = book(chapter.book_id);
          const cover = await generateBookCover(b);
          db.prepare(
            "UPDATE digital_books SET cover_url=?,status='review',page_count=MAX(30,page_count),updated_at=CURRENT_TIMESTAMP WHERE id=?",
          ).run(cover, b.id);
        }
      }
      const readyForCover = db
        .prepare(
          "SELECT * FROM digital_books WHERE status='writing' AND word_count>=9000 AND page_count>=30 AND (cover_url='' OR cover_url IS NULL)",
        )
        .all();
      for (const item of readyForCover) {
        const approved = Number(
          db
            .prepare(
              "SELECT COUNT(*) n FROM digital_book_chapters WHERE book_id=? AND status='approved'",
            )
            .get(item.id).n || 0,
        );
        if (approved < 10) continue;
        const cover = await generateBookCover(item);
        db.prepare(
          "UPDATE digital_books SET cover_url=?,status='review',page_count=MAX(30,page_count),updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(cover, item.id);
      }
      const illustration = db
        .prepare(
          "SELECT c.*,b.title book_title,b.category FROM digital_book_chapters c JOIN digital_books b ON b.id=c.book_id WHERE c.status='approved' AND (c.image_url='' OR c.image_url IS NULL) AND b.status IN ('writing','review') ORDER BY b.created_at,c.position LIMIT 1",
        )
        .get();
      if (illustration) {
        const image = await generateBookIllustration(illustration);
        db.prepare(
          "UPDATE digital_book_chapters SET image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(image, illustration.id);
      }
    } catch (error) {
      console.error(
        "Digital publisher worker failed",
        String(error.message || error),
      );
    } finally {
      running = false;
    }
  }
  db.prepare(
    "UPDATE digital_books SET category='finanças pessoais educativas' WHERE lower(category) LIKE '%econom%' OR lower(category) LIKE '%salário%'",
  ).run();
  setTimeout(worker, 15000).unref();
  setInterval(worker, 2 * 60 * 1000).unref();
}
