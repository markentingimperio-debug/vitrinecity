(() => {
  const FALLBACK_CITIES = [
    { slug:"silvania-go", name:"Silvânia", state:"Goiás", stateCode:"GO", status:"pilot" },
    { slug:"anapolis-go", name:"Anápolis", state:"Goiás", stateCode:"GO", status:"enabled" },
    { slug:"vianopolis-go", name:"Vianópolis", state:"Goiás", stateCode:"GO", status:"enabled" },
  ];
  const FALLBACK_REALMS = [
    { slug:"centro-25d", title:"Centro Vitrine 2.5D", type:"experience", typeLabel:"Experiência", badge:"CIDADE DIGITAL", entryPath:"/cidade-25d-demo.html", image:"/assets/centro-vitrine-25d-v2.webp", description:"Explore ruas, prédios, lojas, serviços e atrações em uma cidade navegável em perspectiva 2.5D." },
    { slug:"mapa-real", title:"Vitrine no Mundo Real", type:"mobility", typeLabel:"Mobilidade", badge:"MAPA REAL", entryPath:"/mapa-real.html", image:"/assets/mapa-mestre.jpg", description:"Veja empresas e pontos da plataforma no mapa real e conecte a experiência digital ao endereço físico." },
    { slug:"vitriny-social", title:"Vitriny Social", type:"social", typeLabel:"Social", badge:"REDE SOCIAL", entryPath:"/social.html", image:"/assets/vitriny-city-norte.jpg", description:"Descubra pessoas, empresas, vídeos, publicações e tendências dentro da camada social da VitrineCity." },
    { slug:"mercado", title:"Mercado & Lojas", type:"commerce", typeLabel:"Comércio", badge:"MARKETPLACE", entryPath:"/loja.html", image:"/assets/vitriny-city-leste.jpg", description:"Entre nas vitrines comerciais, conheça produtos e conecte descoberta, loja e compra no mesmo ecossistema." },
    { slug:"entregas", title:"Vitrine Entregas", type:"mobility", typeLabel:"Mobilidade", badge:"LOGÍSTICA", entryPath:"/entregas.html", image:"/assets/vc-entregas-hero.png", description:"Camada logística para pedidos locais, entregadores, acompanhamento e conexão entre loja e cliente." },
    { slug:"educacao", title:"Centro Educacional", type:"experience", typeLabel:"Experiência", badge:"CONHECIMENTO", entryPath:"/centro-educacional.html", image:"/assets/centro-educacional-premium-v2.png", description:"Cursos, materiais, conteúdos e experiências de aprendizado integrados à cidade digital." },
    { slug:"neural", title:"Vitriny Neural", type:"intelligence", typeLabel:"Inteligência", badge:"IA DA CIDADE", entryPath:"/jarvis-public.html", image:"/assets/cidade-premium.jpg", description:"A camada de inteligência que pesquisa, orienta e conecta capacidades da plataforma em uma única interface." },
    { slug:"navegar", title:"Portal de Navegação", type:"mobility", typeLabel:"Mobilidade", badge:"ROTAS & CIDADES", entryPath:"/navegar.html", image:"/assets/vitriny-city-base.jpg", description:"Ponto de passagem entre cidades, rotas e experiências geográficas do ecossistema VitrineCity." },
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
  const LAST_CITY_KEY = "vitrinecity.multiversal.city";

  let REALMS = [];
  let CITIES = [];
  let activeFilter = "all";
  let activeCitySlug = "silvania-go";
  let resumeRealm = null;
  let cityControl = null;

  const cityStyles = document.createElement("link");
  cityStyles.rel = "stylesheet";
  cityStyles.href = "/multiversal-city.css?v=1";
  document.head.appendChild(cityStyles);

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJson(response) {
    return response.json().catch(() => ({}));
  }

  function appendCity(path, citySlug) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("cidade", citySlug);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function normalizeRealm(realm) {
    const entryPath = realm.entryPath || realm.href || "/multiversal.html";
    return {
      slug: realm.slug,
      title: realm.title,
      type: realm.type || realm.category,
      typeLabel: realm.typeLabel || realm.categoryLabel || realm.category || "Universo",
      badge: realm.badge || "VITRINECITY",
      entryPath,
      href: realm.href || appendCity(entryPath, activeCitySlug),
      image: realm.image || realm.imagePath || "/assets/vitriny-city-master.jpg",
      description: realm.description || "",
    };
  }

  function selectedCity() {
    return CITIES.find(city => city.slug === activeCitySlug) || CITIES[0] || null;
  }

  function getFocusedSlug() {
    return new URLSearchParams(window.location.search).get("universo") || "";
  }

  function rememberRealm(realm) {
    try {
      window.localStorage.setItem(
        LAST_REALM_KEY,
        JSON.stringify({ slug:realm.slug, citySlug:activeCitySlug, visitedAt:Date.now() }),
      );
    } catch (_) {}
  }

  function rememberCity(citySlug) {
    try { window.localStorage.setItem(LAST_CITY_KEY, citySlug); } catch (_) {}
  }

  function updateUrlCity(citySlug) {
    const url = new URL(window.location.href);
    url.searchParams.set("cidade", citySlug);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function buildCityControl() {
    const heroCopy = document.querySelector(".hero-copy");
    if (!heroCopy) return;
    cityControl = document.createElement("div");
    cityControl.className = "city-context";
    cityControl.dataset.loading = "false";
    cityControl.innerHTML = `
      <div class="city-context-icon" aria-hidden="true">⌖</div>
      <div class="city-context-copy">
        <small>CIDADE ATIVA</small>
        <strong id="multiversalCityName">VitrineCity</strong>
        <span id="multiversalCityStatus">Contexto local do ecossistema</span>
      </div>
      <label class="city-context-select-wrap">
        <span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Selecionar cidade</span>
        <select id="multiversalCitySelect" aria-label="Selecionar cidade"></select>
      </label>`;
    const eyebrow = heroCopy.querySelector(".eyebrow");
    eyebrow?.insertAdjacentElement("afterend", cityControl);
  }

  function renderCityControl() {
    if (!cityControl) buildCityControl();
    if (!cityControl) return;
    const select = cityControl.querySelector("#multiversalCitySelect");
    const name = cityControl.querySelector("#multiversalCityName");
    const status = cityControl.querySelector("#multiversalCityStatus");
    select.innerHTML = CITIES.map(city => `<option value="${escapeHtml(city.slug)}"${city.slug === activeCitySlug ? " selected" : ""}>${escapeHtml(city.name)} — ${escapeHtml(city.stateCode || city.state || "")}</option>`).join("");
    const city = selectedCity();
    if (city) {
      name.textContent = `${city.name} — ${city.stateCode || city.state}`;
      status.textContent = city.status === "pilot" ? "Cidade piloto do Multiversal" : "Ecossistema conectado por cidade";
      status.classList.toggle("city-context-status-pilot", city.status === "pilot");
    }
    select.onchange = () => switchCity(select.value);
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

  function render() {
    if (realmCount) realmCount.textContent = String(REALMS.length);
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
      link.addEventListener("click", async event => {
        event.preventDefault();
        const realm = REALMS.find(item => item.slug === link.dataset.enter);
        if (!realm) return;
        rememberRealm(realm);
        let destination = realm.href;
        const saved = (() => {
          try { return JSON.parse(window.localStorage.getItem(LAST_REALM_KEY) || "{}"); }
          catch { return {}; }
        })();
        try {
          const request = fetch("/api/multiversal/transition", {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body:JSON.stringify({
              citySlug:activeCitySlug,
              fromRealm:saved?.slug && saved.slug !== realm.slug ? saved.slug : null,
              toRealm:realm.slug,
              sourcePath:`${window.location.pathname}${window.location.search}`,
            }),
            keepalive:true,
          }).then(async response => response.ok ? safeJson(response) : null);
          const result = await Promise.race([
            request,
            new Promise(resolve => window.setTimeout(() => resolve(null), 500)),
          ]);
          if (result?.href) destination = result.href;
        } catch (_) {}
        window.location.assign(destination);
      });
    });

    if (focusedSlug) {
      window.requestAnimationFrame(() => {
        const target = grid.querySelector(`[data-realm="${CSS.escape(focusedSlug)}"]`);
        target?.scrollIntoView({ block:"center", behavior:"smooth" });
      });
    }
  }

  function loadResume() {
    resumeCard.hidden = true;
    resumeRealm = null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(LAST_REALM_KEY) || "{}");
      if (!saved.slug || (saved.citySlug && saved.citySlug !== activeCitySlug)) return;
      resumeRealm = REALMS.find(realm => realm.slug === saved.slug) || null;
      if (!resumeRealm) return;
      resumeTitle.textContent = resumeRealm.title;
      resumeDescription.textContent = resumeRealm.description;
      resumeCard.hidden = false;
    } catch (_) {}
  }

  async function loadRealms(citySlug) {
    cityControl && (cityControl.dataset.loading = "true");
    try {
      const response = await fetch(`/api/multiversal/realms?cidade=${encodeURIComponent(citySlug)}`, { headers:{ Accept:"application/json" } });
      if (!response.ok) throw new Error("multiversal_realms_unavailable");
      const payload = await safeJson(response);
      REALMS = Array.isArray(payload.items) ? payload.items.map(normalizeRealm) : [];
      if (!REALMS.length) throw new Error("multiversal_realms_empty");
    } catch (_) {
      REALMS = FALLBACK_REALMS.map(realm => normalizeRealm({ ...realm, href:appendCity(realm.entryPath, citySlug) }));
    } finally {
      cityControl && (cityControl.dataset.loading = "false");
    }
    render();
    loadResume();
  }

  async function switchCity(citySlug) {
    if (!CITIES.some(city => city.slug === citySlug)) return;
    activeCitySlug = citySlug;
    rememberCity(citySlug);
    updateUrlCity(citySlug);
    renderCityControl();
    await loadRealms(citySlug);
  }

  async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    let savedCity = "";
    try { savedCity = window.localStorage.getItem(LAST_CITY_KEY) || ""; } catch (_) {}

    try {
      const response = await fetch("/api/multiversal/cities", { headers:{ Accept:"application/json" } });
      if (!response.ok) throw new Error("multiversal_cities_unavailable");
      const payload = await safeJson(response);
      CITIES = Array.isArray(payload.items) && payload.items.length ? payload.items : FALLBACK_CITIES;
      const requested = params.get("cidade") || savedCity || payload.defaultCity || "silvania-go";
      activeCitySlug = CITIES.some(city => city.slug === requested) ? requested : (payload.defaultCity || CITIES[0].slug);
    } catch (_) {
      CITIES = FALLBACK_CITIES;
      const requested = params.get("cidade") || savedCity || "silvania-go";
      activeCitySlug = CITIES.some(city => city.slug === requested) ? requested : "silvania-go";
    }

    rememberCity(activeCitySlug);
    updateUrlCity(activeCitySlug);
    renderCityControl();
    await loadRealms(activeCitySlug);
  }

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      filterButtons.forEach(item => item.classList.toggle("active", item === button));
      render();
    });
  });

  search?.addEventListener("input", render);
  resumeButton?.addEventListener("click", () => {
    if (!resumeRealm) return;
    rememberRealm(resumeRealm);
    window.location.assign(resumeRealm.href);
  });

  bootstrap();
})();