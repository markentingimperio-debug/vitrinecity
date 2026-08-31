(() => {
  const element = (tag, options = {}, children = []) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    for (const [name, value] of Object.entries(options.attributes || {})) {
      node.setAttribute(name, String(value));
    }
    node.append(...children.filter(Boolean));
    return node;
  };

  const empty = (tag, className, text) => element(tag, { className, text });

  const safeInternalPath = value => {
    try {
      const parsed = new URL(String(value || ''), location.origin);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/')) return '';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '';
    }
  };

  const safeImageUrl = value => {
    try {
      const parsed = new URL(String(value || ''), location.origin);
      if (parsed.username || parsed.password) return '';
      if (parsed.origin === location.origin && ['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  };

  const safePlayerUrl = value => {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.username || parsed.password) return '';
      return parsed.origin === 'https://iframe.videodelivery.net' ? parsed.href : '';
    } catch {
      return '';
    }
  };

  window.VitrineDiscoverRenderer = Object.freeze({ element, empty, safeInternalPath, safeImageUrl, safePlayerUrl });
})();
