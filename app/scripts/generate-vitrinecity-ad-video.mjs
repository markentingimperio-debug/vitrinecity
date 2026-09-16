import fs from 'node:fs/promises';
import path from 'node:path';
import {createMediaProvider} from '../ai-media-provider.js';
import {videoPollState} from '../video-provider-receipts.js';

const client=createMediaProvider(),mediaConfig=client.config;
if(!mediaConfig.videoEnabled)throw new Error(mediaConfig.videoReason||'A geração de vídeo está indisponível.');
if(mediaConfig.videoDurationOptions?.length&&!mediaConfig.videoDurationOptions.includes(30))throw new Error('Este roteiro de anúncio tem 30 segundos. O Google Veo aceita cenas de 4, 6 ou 8 segundos; prepare uma montagem de cenas com roteiro compatível antes de gerar. Nenhuma solicitação foi enviada.');
const prompt=`Vídeo publicitário vertical 9:16, 30 segundos, em português do Brasil, para Reels, TikTok, Stories e VitrineCity Social. Sem apresentador visível. Narração brasileira clara, confiante e acolhedora. Comece com uma busca local no celular e uma loja difícil de encontrar. Mostre informações desatualizadas e poucas fotos, sem usar marcas de terceiros. Faça uma transição positiva para um perfil local organizado, fotos profissionais, mapa, página empresarial responsiva, WhatsApp e botão de contato. Narração: "Sua loja aparece quando o cliente pesquisa no Google? Informações desatualizadas, poucas fotos e uma página confusa podem fazer você perder oportunidades. A VitrineCity organiza sua presença no Google e Maps por cento e cinquenta reais. E cria uma página profissional para sua empresa por quinhentos reais. Sua loja mais fácil de encontrar, conhecer e contatar. Acesse vitrinecity.com." Texto crítico na tela, exatamente em português: "SUA LOJA PRECISA SER ENCONTRADA"; "Google & Maps por R$ 150"; "Página profissional por R$ 500"; "Conheça a VitrineCity"; "vitrinecity.com". Use motion graphics para textos, preços, mapa, busca e botões; fachadas realistas e comerciantes locais. Estilo geométrico premium, tipografia grande e legível, cores azul-marinho #071F4B, azul #1768E6, amarelo #FFC628 e branco. Cortes limpos no ritmo. Inclua legendas. Não use métricas falsas, promessas de vendas ou garantia de posicionamento.`;
const submit=await client.createVideo({model:mediaConfig.videoModel,prompt,aspectRatio:'9:16',durationSeconds:30,generateAudio:true});
const receipt=client.videoReceipt(submit.data);
if(!receipt.jobId||!receipt.pollingUrl)throw new Error('Recibo do vídeo precisa de conferência. Não repita a geração.');
const job={provider:mediaConfig.videoProvider||mediaConfig.provider,...receipt};
console.log(JSON.stringify({event:'submitted',provider:job.provider,id:job.jobId,status:submit.data.status}));
const deadline=Date.now()+30*60*1000;let result=submit.data;
while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,15000));result=(await client.getVideo(job)).data;const status=videoPollState(result,job.jobId);console.log(JSON.stringify({event:'progress',status}));if(status==='completed')break;}
if(videoPollState(result,job.jobId)!=='completed')throw new Error('Tempo excedido aguardando o vídeo.');
const content=await client.downloadVideo(result,job);
const folder='/data/generated-videos';await fs.mkdir(folder,{recursive:true});const filename='vitrinecity-lojas-locais-vertical.mp4';await fs.writeFile(path.join(folder,filename),content);
console.log(JSON.stringify({event:'completed',path:`/uploads/generated-videos/${filename}`,jobId:job.jobId}));
