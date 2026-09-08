import {createMediaRecommendationLoader} from './vitriny-media-recommendations-core.js';

// Mount in a normal page container outside the video iframe. No player access,
// account data, persistence, tracking events or third-party asset requests.
export function mountMediaRecommendations(container, {scope = 'music', fetchImpl = globalThis.fetch, origin = globalThis.location?.origin || 'https://vitrinecity.com', onClose = () => {}} = {}) {
  if (!container?.ownerDocument) throw new TypeError('A page container is required.');
  const document = container.ownerDocument;
  const make = (tag, value, className) => {
    const element = document.createElement(tag);
    if (value) element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  const section = make('section', '', 'media-recommendations');
  section.hidden = true;
  section.setAttribute('aria-label', 'Produtos e cursos relacionados à seleção');
  const heading = make('div', '', 'media-recommendations-heading');
  const copy = make('div');
  copy.append(make('h2', 'Para acompanhar sua experiência'), make('p', 'Sugestões pelo tema desta seleção.'));
  const close = make('button', '×', 'media-recommendations-close');
  close.type = 'button'; close.setAttribute('aria-label', 'Fechar sugestões de produtos e cursos');
  heading.append(copy, close);
  const list = make('ul', '', 'media-recommendations-list');
  section.append(heading, list); container.append(section);
  const loader = createMediaRecommendationLoader({scope, fetchImpl, origin, onResults(items) {
    list.replaceChildren(...items.map(item => {
      const row = make('li'), link = make('a'); link.href = item.href;
      if (item.affiliate) link.rel = 'sponsored';
      link.append(make('small', item.affiliate ? 'Oferta de afiliado' : item.kind === 'course' ? 'Curso da cidade' : 'Produto da cidade'), make('strong', item.title), make('span', item.reason), make('b', 'Ver detalhes →'));
      row.append(link); return row;
    }));
    section.hidden = !items.length;
  }});
  close.addEventListener('click', () => {loader.dismiss(); onClose();});
  return {update:loader.update, clear:loader.clear, destroy() {loader.destroy(); section.remove();}};
}
