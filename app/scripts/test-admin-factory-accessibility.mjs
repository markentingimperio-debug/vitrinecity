import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/admin-agentes.html', import.meta.url), 'utf8');
const section = html.match(/<section\b[^>]*\bid=["']fabrica-neural-media["'][^>]*>([\s\S]*?)<\/section>/)?.[1];
assert.ok(section, 'The media factory section must exist');
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
  .map(match => match[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

// Read the simple style rules and their enclosing media queries, without a DOM
// dependency. Actual layout and computed sizes are checked in browser QA.
function cssRules(source, media = []) {
  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open === -1) break;
    let depth = 1;
    let end = open + 1;
    for (; end < source.length && depth; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    const selector = source.slice(cursor, open).trim();
    const body = source.slice(open + 1, end - 1);
    if (selector.startsWith('@media')) {
      rules.push(...cssRules(body, [...media, selector]));
    } else if (!selector.startsWith('@')) {
      const declarations = Object.fromEntries(body.split(';').filter(value => value.includes(':')).map(value => {
        const colon = value.indexOf(':');
        return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
      }));
      for (const item of selector.split(',')) rules.push({selector: item.trim(), declarations, media});
    }
    cursor = end;
  }
  return rules;
}

const rules = cssRules(css);
const scope = '#fabrica-neural-media';
function declarations(selector, mobile = false) {
  const matched = rules.filter(rule => rule.selector === `${scope} ${selector}` &&
    (mobile ? rule.media.some(query => {
      const maxWidth = Number(query.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/)?.[1]);
      return maxWidth >= 390 && maxWidth <= 700;
    }) : !rule.media.length));
  assert.ok(matched.length, `Missing ${mobile ? 'mobile ' : ''}factory rule for ${selector}`);
  return Object.assign({}, ...matched.map(rule => rule.declarations));
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map(match => [match[1], match[3]]));
}

function sourceBetween(startPattern, endPattern) {
  const start = html.search(startPattern);
  assert.notEqual(start, -1, `Missing script start: ${startPattern}`);
  const remainder = html.slice(start);
  const end = remainder.search(endPattern);
  assert.ok(end > 0, `Missing script end: ${endPattern}`);
  return remainder.slice(0, end);
}

const escapeSource = sourceBetween(/const\s+esc\s*=/, /async\s+function\s+api\s*\(/);
const renderSource = sourceBetween(/function\s+renderFactory\s*\(/, /\$\(["']#factoryForm["']\)\.onsubmit/);

function render(projects) {
  const nodes = {'#factoryJobs': {}, '#factoryBudget': {}};
  const context = {
    window: {}, mediaProjects: projects,
    $: id => nodes[id], updateFactoryModels: () => {}, usd: value => `$${Number(value || 0).toFixed(2)}`,
  };
  vm.runInNewContext(`${escapeSource}\n${renderSource}\nrenderFactory({});`, context, {timeout: 1000});
  return nodes['#factoryJobs'].innerHTML;
}

function project(overrides = {}) {
  return {id: 7, title: 'Criação de teste', format: 'short_video', aspect_ratio: '9:16',
    model: 'modelo-de-teste', production_status: 'approved', progress: 100, ...overrides};
}

function actions(markup) {
  return [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => {
    const attrs = attributes(match[0]);
    assert.equal(attrs['data-media'], '7', 'Actions must retain their project identifier');
    assert.ok(match[0].replace(/<[^>]*>/g, '').trim(), 'Every action must have a visible name');
    assert.notEqual(attrs['aria-hidden'], 'true');
    assert.ok(!(Number(attrs.tabindex) > 0), 'Actions must keep the native keyboard order');
    return attrs['data-media-action'];
  });
}

test('all eight factory controls have unique IDs and explicit visible labels', () => {
  const expected = ['factoryFormat', 'factoryRatio', 'factoryModel', 'factoryTitle',
    'factoryPrompt', 'factoryDuration', 'factoryChannels', 'factoryCaption'];
  const controls = [...section.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map(match => attributes(match[0]));
  assert.deepEqual(controls.map(control => control.id).sort(), [...expected].sort());
  for (const id of expected) {
    const labels = [...section.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)]
      .filter(match => attributes(match[1]).for === id);
    assert.equal(labels.length, 1, `${id} must have exactly one explicit label`);
    assert.match(labels[0][2], /<span\b[^>]*>\s*[^<\s][\s\S]*?<\/span>/, `${id} needs a visible label`);
    assert.equal([...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].filter(match => match[2] === id).length, 1);
  }
  assert.match(section, /<button\b[^>]*\btype=["']submit["'][^>]*>\s*Criar projeto supervisionado\s*<\/button>/);
});

test('factory touch targets and keyboard focus are explicitly scoped to all native controls', () => {
  for (const tag of ['button', 'input', 'select', 'textarea']) {
    const style = declarations(tag);
    for (const property of ['min-height', 'min-width']) {
      assert.match(style[property] || '', /^\d+(?:\.\d+)?px$/);
      assert.ok(parseFloat(style[property]) >= 44, `${tag} ${property} must be at least 44px`);
    }
    const focus = declarations(`${tag}:focus-visible`);
    assert.match(focus.outline || '', /\b(?:solid|double|dashed|dotted)\b/);
    assert.ok(parseFloat(focus.outline) >= 2, `${tag} needs a visible focus outline`);
    assert.ok(parseFloat(focus['outline-offset']) > 0, `${tag} focus must be separated from its border`);
  }
});

test('factory grids shrink safely and use one column on mobile', () => {
  const desktop = declarations('.factory-grid')['grid-template-columns']?.replace(/\s+/g, '');
  assert.ok(['repeat(2,minmax(0,1fr))', 'minmax(0,1fr)minmax(0,1fr)'].includes(desktop));
  const mobile = declarations('.factory-grid', true)['grid-template-columns']?.replace(/\s+/g, '');
  assert.ok(['minmax(0,1fr)', 'repeat(1,minmax(0,1fr))', '1fr'].includes(mobile));
  for (const selector of ['.field', '.factory-job']) {
    assert.match(declarations(selector)['min-width'] || '', /^0(?:px)?$/);
  }
});

test('long factory metadata and action labels can wrap inside the card', () => {
  assert.equal(declarations('.factory-job')['overflow-wrap'], 'anywhere');
  assert.equal(declarations('button')['overflow-wrap'], 'anywhere');
  assert.equal(declarations('button')['white-space'], 'normal');
  for (const tag of ['button', 'input', 'select', 'textarea']) {
    assert.equal(declarations(tag)['max-width'], '100%');
  }
});

test('factory card titles contrast with the white card and mobile input text stays legible', () => {
  const color = declarations('.factory-job').color;
  assert.match(color || '', /^#[\da-f]{6}$/i);
  const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  assert.ok(1.05 / (luminance + 0.05) >= 4.5, 'Title contrast on white must reach 4.5:1');
  for (const tag of ['input', 'select', 'textarea']) {
    const fontSize = declarations(tag, true)['font-size'];
    assert.match(fontSize || '', /^\d+(?:\.\d+)?px$/);
    assert.ok(parseFloat(fontSize) >= 16, `${tag} mobile text must be at least 16px`);
  }
});

for (const [status, expected] of [
  ['briefing', ['generate']], ['script', ['generate']], ['assets', ['generate']],
  ['editing', ['sync']], ['review', ['approve']], ['approved', []], ['published', []], ['failed', []],
]) {
  test(`factory ${status} retains its eligible, keyboard-accessible production actions`, () => {
    assert.deepEqual(actions(render([project({production_status: status})])), expected);
  });
}

test('publication and reconciliation buttons require their respective eligibility flags', () => {
  for (const canPublish of [undefined, false, true]) {
    for (const canReconcile of [undefined, false, true]) {
      const publication = {status: 'not_started', message: 'Aguardando publicação', canPublish, canReconcile};
      assert.deepEqual(actions(render([project({publication})])), [
        ...(canPublish ? ['publish-vitriny'] : []), ...(canReconcile ? ['sync-publication'] : []),
      ]);
    }
  }
});

test('uncertain sends cannot be resent and reconciliation uses the existing receipt', () => {
  for (const status of ['unknown', 'processing']) {
    const publication = {status, message: 'Envio ainda sem confirmação.', canPublish: false, canReconcile: false};
    assert.deepEqual(actions(render([project({production_status: 'published', publication})])), []);
    const reconcilable = render([project({publication: {...publication, canReconcile: true}})]);
    assert.deepEqual(actions(reconcilable), ['sync-publication']);
    assert.match(reconcilable, /comprovante existente e não envia outro vídeo/);
    assert.doesNotMatch(reconcilable, /Publicado na Vitrine Social/);
  }
  assert.match(render([project({production_status: 'published'})]), /Situação da publicação indisponível/);
});

test('rendered statuses, metadata, and image attributes escape untrusted text', () => {
  const markup = render([project({
    format: 'image', title: '<title>"\'&', model: '<model>' + 'x'.repeat(500),
    aspect_ratio: '<ratio>', error_message: '<error>',
    output_url: 'https://example.invalid/media?label="<image>"&v=1',
    publication: {status: 'unknown', message: '<message>"\'&', canPublish: false, canReconcile: false},
  })]);
  for (const name of ['title', 'model', 'ratio', 'error', 'image', 'message']) {
    assert.ok(markup.includes(`&lt;${name}&gt;`), `${name} must be escaped`);
    assert.ok(!markup.includes(`<${name}>`));
  }
  assert.match(markup, /alt="&lt;title&gt;&quot;&#39;&amp;"/);
  assert.match(markup, /src="https:\/\/example\.invalid\/media\?label=&quot;&lt;image&gt;&quot;&amp;v=1"/);
  assert.match(markup, /<p\b[^>]*\brole="status"[^>]*>&lt;message&gt;&quot;&#39;&amp;<\/p>/);
  assert.deepEqual(actions(markup), []);
});

test('video previews retain native controls and an empty factory has no paid action', () => {
  assert.match(render([project({output_url: 'https://example.invalid/video.mp4'})]), /<video\b[^>]*\bcontrols\b/);
  const empty = render([]);
  assert.match(empty, /Crie o primeiro projeto/);
  assert.deepEqual(actions(empty), []);
});
