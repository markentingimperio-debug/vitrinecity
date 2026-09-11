import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectPublicMeasurement } from './public-measurement.js';
import { injectSiteAssistant } from './site-assistant-page.js';
const publicRoot = fileURLToPath(new URL('./public', import.meta.url));
// Run during the image build so sendFile/static routes receive the same loader.
function visit(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entry.name.startsWith('admin')||entry.name==='recuperar-acesso-entregador.html'||entry.isSymbolicLink())continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()){visit(file);continue;}
    if(!entry.name.endsWith('.html'))continue;
    const original=fs.readFileSync(file,'utf8');
    const pathname='/'+path.relative(publicRoot,file).split(path.sep).join('/');
    let html=injectPublicMeasurement(original,pathname);
    html=injectSiteAssistant(html,{path:pathname});
    if(!['/course-checkout.html','/presente.html'].includes(pathname)&&/<\/body>/i.test(html)&&!html.includes('/global-market-banner.js'))html=html.replace(/<\/body>/i,'<script src="/global-market-banner.js?v=9" defer></script></body>');
    if(html!==original)fs.writeFileSync(file,html);
  }
}
visit(publicRoot);
