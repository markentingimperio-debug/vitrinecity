// Local-only visual test fixture. Not copied into the production application image.
import express from '../../app/node_modules/express/index.js';
import Database from '../../app/node_modules/better-sqlite3/lib/index.js';
import { fileURLToPath } from 'node:url';
import { mountJarvis } from '../../app/jarvis-core.js';
const app=express(),db=new Database(':memory:');
app.use(express.json({limit:'16kb'}));
mountJarvis({app,db,env:{JARVIS_LOCAL_MODEL:'0'},requireAdmin:(req,res,next)=>{req.user={id:1};next();},sameOriginOnly:(req,res,next)=>next()});
app.use(express.static(fileURLToPath(new URL('../../app/public/',import.meta.url))));
app.listen(39876,'127.0.0.1',()=>console.log('Synthetic Jarvis preview at http://127.0.0.1:39876/admin-jarvis.html'));
