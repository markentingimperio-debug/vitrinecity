import fs from 'node:fs/promises';
import path from 'node:path';

const apiKey=String(process.env.OPENROUTER_API_KEY||'').trim();
if(!apiKey)throw new Error('OPENROUTER_API_KEY não configurada.');
const prompt=`Vídeo publicitário vertical 9:16, 30 segundos, em português do Brasil, para Reels, TikTok, Stories e VitrineCity Social. Sem apresentador visível. Narração brasileira clara, confiante e acolhedora. Comece com uma busca local no celular e uma loja difícil de encontrar. Mostre informações desatualizadas e poucas fotos, sem usar marcas de terceiros. Faça uma transição positiva para um perfil local organizado, fotos profissionais, mapa, página empresarial responsiva, WhatsApp e botão de contato. Narração: "Sua loja aparece quando o cliente pesquisa no Google? Informações desatualizadas, poucas fotos e uma página confusa podem fazer você perder oportunidades. A VitrineCity organiza sua presença no Google e Maps por cento e cinquenta reais. E cria uma página profissional para sua empresa por quinhentos reais. Sua loja mais fácil de encontrar, conhecer e contatar. Acesse vitrinecity.com." Texto crítico na tela, exatamente em português: "SUA LOJA PRECISA SER ENCONTRADA"; "Google & Maps por R$ 150"; "Página profissional por R$ 500"; "Conheça a VitrineCity"; "vitrinecity.com". Use motion graphics para textos, preços, mapa, busca e botões; fachadas realistas e comerciantes locais. Estilo geométrico premium, tipografia grande e legível, cores azul-marinho #071F4B, azul #1768E6, amarelo #FFC628 e branco. Cortes limpos no ritmo. Inclua legendas. Não use métricas falsas, promessas de vendas ou garantia de posicionamento.`;
const headers={Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','HTTP-Referer':'https://vitrinecity.com','X-Title':'VitrineCity'};
const submit=await fetch('https://openrouter.ai/api/v1/videos',{method:'POST',headers,body:JSON.stringify({model:'alibaba/wan-3.0',prompt,aspect_ratio:'9:16',duration:30,resolution:'720p',generate_audio:true})});
const job=await submit.json();
if(!submit.ok||!job.id)throw new Error(`Falha ao iniciar vídeo: ${job.error?.message||submit.status}`);
console.log(JSON.stringify({event:'submitted',id:job.id,status:job.status}));
const pollUrl=new URL(job.polling_url||`/api/v1/videos/${job.id}`,'https://openrouter.ai').toString();
const deadline=Date.now()+30*60*1000;let result=job;
while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,15000));const response=await fetch(pollUrl,{headers});result=await response.json();console.log(JSON.stringify({event:'progress',status:result.status}));if(result.status==='completed')break;if(['failed','cancelled'].includes(result.status))throw new Error(`Geração encerrada: ${result.error?.message||result.status}`);}
if(result.status!=='completed')throw new Error('Tempo excedido aguardando o vídeo.');
const contentUrl=new URL(result.content_url||`/api/v1/videos/${job.id}/content`,'https://openrouter.ai').toString();
const content=await fetch(contentUrl,{headers:{Authorization:`Bearer ${apiKey}`}});if(!content.ok)throw new Error(`Falha ao baixar vídeo: ${content.status}`);
const folder='/data/generated-videos';await fs.mkdir(folder,{recursive:true});const filename='vitrinecity-lojas-locais-vertical.mp4';await fs.writeFile(path.join(folder,filename),Buffer.from(await content.arrayBuffer()));
console.log(JSON.stringify({event:'completed',path:`/uploads/generated-videos/${filename}`,jobId:job.id}));
