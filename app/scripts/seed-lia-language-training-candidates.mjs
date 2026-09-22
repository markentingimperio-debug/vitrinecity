import Database from 'better-sqlite3';
import {createNeuralDatasetBuilder} from '../vitriny-neural/dataset-builder.js';

const dbPath=process.argv.find(value=>value.startsWith('--database='))?.slice(11);
if(!dbPath||!dbPath.startsWith('/'))throw new Error('absolute_database_path_required');
const db=new Database(dbPath);
const builder=createNeuralDatasetBuilder({db,nodeId:'lia-language-eval-v1'});
const cases=[
  {id:'lia-lang-cal-youtube-typo-v1',domain:'operations',instruction:'acesa o youtub e colca uma musica eletronica pra toca',input:'Caso técnico verificado: o destino é o YouTube e a intenção é pesquisar, abrir o primeiro vídeo e tentar reproduzir.',expectedOutput:'Interpretar como navegação no YouTube, pesquisar por “música eletrônica”, abrir o primeiro vídeo reproduzível e só afirmar reprodução quando o player confirmar. Se a reprodução não for confirmada, informar a limitação e devolver o endereço do vídeo aberto.'},
  {id:'lia-lang-cal-context-v1',domain:'operations',instruction:'buscar a música e abrir o primeiro vídeo reproduzível',input:'Mensagem anterior aprovada: “abra o YouTube e coloque música eletrônica para tocar”.',expectedOutput:'Manter o YouTube como destino, reaproveitar a busca por “música eletrônica” e abrir o primeiro resultado de vídeo. Não transformar a continuação em uma pesquisa geral da internet.'},
  {id:'lia-lang-cal-false-positive-v1',domain:'code',instruction:'faça um site para minha loja',input:'Avaliação de roteamento: a palavra “faça” não é uma referência ao Facebook.',expectedOutput:'Encaminhar como tarefa de criação de site. Não abrir Facebook nem outro endereço por semelhança ortográfica.'}
];
const results=cases.map(item=>builder.createCandidate({...item,source:'evaluation',sourceId:'lia-language-eval-20260922-v1',actor:'lia-eval-suite'}));
console.log(JSON.stringify({created:results.filter(item=>!item.duplicate).length,duplicates:results.filter(item=>item.duplicate).length,status:builder.status()}));
db.close();
