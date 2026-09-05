import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Run during the image build so sendFile/static routes receive the same loader.
function visit(dir) {
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if(entry.name.startsWith('admin')||entry.isSymbolicLink())continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()){visit(file);continue;}
    if(!entry.name.endsWith('.html'))continue;
    const html=fs.readFileSync(file,'utf8');
    if(!/<\/body>/i.test(html)||html.includes('/global-market-banner.js'))continue;
    fs.writeFileSync(file,html.replace(/<\/body>/i,'<script src="/global-market-banner.js?v=7" defer></script></body>'));
  }
}
visit(fileURLToPath(new URL('./public',import.meta.url)));
