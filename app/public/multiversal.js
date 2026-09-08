(() => {
  const REALMS = [
    {
      slug: "centro-25d",
      title: "Centro Vitrine 2.5D",
      type: "experience",
      typeLabel: "Experiência",
      badge: "CIDADE DIGITAL",
      href: "/cidade-25d-demo.html",
      image: "/assets/centro-vitrine-25d-v2.webp",
      description: "Explore ruas, prédios, lojas, serviços e atrações em uma cidade navegável em perspectiva 2.5D.",
    },
    {
      slug: "mapa-real",
      title: "Vitrine no Mundo Real",
      type: "mobility",
      typeLabel: "Mobilidade",
      badge: "MAPA REAL",
      href: "/mapa-real.html",
      image: "/assets/mapa-mestre.jpg",
      description: "Veja empresas e pontos da plataforma no mapa real e conecte a experiência digital ao endereço físico.",
    },
    {
      slug: "vitriny-social",
      title: "Vitriny Social",
      type: "social",
      typeLabel: "Social",
      badge: "REDE SOCIAL",
      href: "/social.html",
      image: "/assets/vitriny-city-norte.jpg",
      description: "Descubra pessoas, empresas, vídeos, publicações e tendências dentro da camada social da VitrineCity.",
    },
    {
      slug: "mercado",
      title: "Mercado & Lojas",
      type: "commerce",
      typeLabel: "Comércio",
      badge: "MARKETPLACE",
      href: "/loja.html",
      image: "/assets/vitriny-city-leste.jpg",
      description: "Entre nas vitrines comerciais, conheça produtos e conecte descoberta, loja e compra no mesmo ecossistema.",
    },
    {
      slug: "entregas",
      title: "Vitrine Entregas",
      type: "mobility",
      typeLabel: "Mobilidade",
      badge: "LOGÍSTICA",
      href: "/entregas.html",
      image: "/assets/vc-entregas-hero.png",
      description: "Camada logística para pedidos locais, entregadores, acompanhamento e conexão entre loja e cliente.",
    },
    {
      slug: "educacao",
      title: "Centro Educacional",
      type: "experience",
      typeLabel: "Experiência",
      badge: "CONHECIMENTO",
      href: "/centro-educacional.html",
      image: "/assets/centro-educacional-premium-v2.png",
      description: "Cursos, materiais, conteúdos e experiências de aprendizado integrados à cidade digital.",
    },
    {
      slug: "neural",
      title: "Vitriny Neural",
      type: "intelligence",
      typeLabel: "Inteligência",
      badge: "IA DA CIDADE",
      href: "/jarvis-public.html",
      image: "/assets/cidade-premium.jpg",
      description: "A camada de inteligência que pesquisa, orienta e conecta capacidades da plataforma em uma única interface.",
    },
    {
      slug: "navegar",
      title: "Portal de Navegação",
      type: "mobility",
      typeLabel: "Mobilidade",
      badge: "ROTAS & CIDADES",
      href: "/navegar.html",
      image: "/assets/vitriny-city-base.jpg",
      description: "Ponto de passagem entre cidades, rotas e experiências geográficas do ecossistema VitrineCity.",
    },
  ];

  const grid = document.getElementById("realmGrid");
  const empty = document.getElementById("realmEmpty");
  const search = document.getElementById("realmSearch");
  const filterButtons = [...document.querySelectorAll("#realmFilters button")];
  const resumeCard = document.getElementById("resumeCard");
  const resumeTitle = document.getElementById("resumeTitle");
  const resumeDescription = document.getElementById("resumeDescription");
  const resumeButton = document.getElementById("resumeButton");
  const realmCount = document.getElementById("realmCount");
  const LAST_REALM_KEY = "vitrinecity.multiversal.lastRealm";

  let activeFilter = "all";
  let resumeRealm = null;

  if (realmCount) realmCount.textContent = String(REALMS.length);

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function rememberRealm(realm) {
    try {
      window.localStorage.setItem(
        LAST_REALM_KEY,
        JSON.stringify({ slug: realm.slug, visitedAt: Date.now() }),
      );
    } catch (_) {}
  }

  function navigateToRealm(realm) {
    rememberRealm(realm);
    window.location.assign(realm.href);
  }

  function realmCard(realm, focusedSlug) {
    const isTarget = realm.slug === focusedSlug;
    return `
      <article class="realm-card${isTarget ? " is-target" : ""}" data-realm="${escapeHtml(realm.slug)}">
        <div class="realm-media">
          <img src="${escapeHtml(realm.image)}" alt="" loading="lazy" decoding="async" />
          <span class="realm-badge">${escapeHtml(realm.badge)}</span>
        </div>
        <div class="realm-body">
          <small>${escapeHtml(realm.typeLabel)}</small>
          <h3>${escapeHtml(realm.title)}</h3>
          <p>${escapeHtml(realm.description)}</p>
          <a class="realm-enter" href="${escapeHtml(realm.href)}" data-enter="${escapeHtml(realm.slug)}">
            <span>Entrar neste universo</span><span aria-hidden="true">→</span>
          </a>
        </div>
      </article>`;
  }

  function getFocusedSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get("universo") || "";
  }

  function render() {
    const query = (search?.value || "").trim().toLocaleLowerCase("pt-BR");
    const focusedSlug = getFocusedSlug();
    const visible = REALMS.filter((realm) => {
      const matchesFilter = activeFilter === "all" || realm.type === activeFilter;
      const haystack = `${realm.title} ${realm.typeLabel} ${realm.badge} ${realm.description}`.toLocaleLowerCase("pt-BR");
      return matchesFilter && (!query || haystack.includes(query));
    });

    grid.innerHTML = visible.map((realm) => realmCard(realm, focusedSlug)).join("");
    empty.hidden = visible.length > 0;

    grid.querySelectorAll("[data-enter]").forEach((link) => {
      link.addEventListener("click", () => {
        const realm = REALMS.find((item) => item.slug === link.dataset.enter);
        if (realm) rememberRealm(realm);
      });
    });

    if (focusedSlug) {
      window.requestAnimationFrame(() => {
        const target = grid.querySelector(`[data-realm="${CSS.escape(focusedSlug)}"]`);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  }

  function loadResume() {
    try {
      const raw = window.localStorage.getItem(LAST_REALM_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      resumeRealm = REALMS.find((realm) => realm.slug === saved.slug) || null;
      if (!resumeRealm) return;
      resumeTitle.textContent = resumeRealm.title;
      resumeDescription.textContent = resumeRealm.description;
      resumeCard.hidden = false;
    } catch (_) {}
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      filterButtons.forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  search?.addEventListener("input", render);
  resumeButton?.addEventListener("click", () => {
    if (resumeRealm) navigateToRealm(resumeRealm);
  });

  loadResume();
  render();
})();
