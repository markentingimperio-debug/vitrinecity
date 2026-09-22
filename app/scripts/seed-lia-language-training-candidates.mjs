import Database from 'better-sqlite3';
import path from 'node:path';
import {createNeuralDatasetBuilder} from '../vitriny-neural/dataset-builder.js';
import {liaLanguageTrainingCases as cases,liaLanguageTrainingProvenance as provenance} from './fixtures/lia-language-training-cases.mjs';

const dbPath=process.argv.find(value=>value.startsWith('--database='))?.slice(11);
if(!dbPath||!path.isAbsolute(dbPath))throw new Error('absolute_database_path_required');
const db=new Database(dbPath);
const builder=createNeuralDatasetBuilder({db,nodeId:'lia-language-eval-v1'});
const results=cases.map(item=>builder.createCandidate({...item,...provenance,actor:'lia-eval-suite'}));
console.log(JSON.stringify({created:results.filter(item=>!item.duplicate).length,duplicates:results.filter(item=>item.duplicate).length,status:builder.status()}));
db.close();
