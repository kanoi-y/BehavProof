import {collectEvidenceFiles,encodeEvidenceFiles} from './evidence-files.js';
import type {Config} from '@behavproof/core';
import {formalEvidenceInventory} from './formal-artifacts.js';
import {executeFormal} from './formal.js';
import {exists} from './project.js';

/** Snapshot trustworthy tool output before any project Driver or tests are loaded. */
export async function captureQualityFormals(root:string,config:Config,configPath:string,toolRoot:string,
  run:typeof executeFormal=executeFormal){
  const models=config.formal?.models??[];
  const inventory=formalEvidenceInventory(config);
  const conformance=new Set(models.flatMap(model=>model.conformanceReport?[model.conformanceReport]:[]));
  const produced=new Set<string>();
  for(const model of models){
    const values={config:configPath,model:model.id};
    try{
      await run(root,'check',values,toolRoot);
      produced.add(model.id);
    }catch{
      // Gate still evaluates the registered model if the verifier cannot produce evidence.
      continue;
    }
    if(model.witnesses?.length||model.mutants?.length){
      try{await run(root,'adequacy',values,toolRoot);}catch{}
    }
  }
  const files=await collectEvidenceFiles(root,[...inventory].filter(ref=>!conformance.has(ref)));
  for(const model of models){
    const ref=model.conformanceReport;
    if(!ref||!model.implementation||!model.driver||!produced.has(model.id)||await exists(root,ref))continue;
    try{await run(root,'replay',{config:configPath,model:model.id},toolRoot);}catch{continue;}
    await collectEvidenceFiles(root,[ref],files);
  }
  return encodeEvidenceFiles(files);
}
