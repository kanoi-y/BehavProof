import {RelativePathSchema,type Config} from '@behavproof/core';
import {traceDirectory,traceReceiptRef} from './formal.js';
import {adequacyReportRef} from './formal-adequacy.js';

import {maxEvidenceFiles} from './evidence-files.js';

export const formalEvidenceArtifact='formal-evidence.json';
export function formalEvidenceInventory(config:Config):ReadonlySet<string>{
  const refs=new Set<string>();
  const add=(ref:string)=>{
    RelativePathSchema.parse(ref);
    if(!/^\.behavproof\/(?!input(?:\/|$)|quality-worker-|assurance-media\/|formal-runs\/|formal-replays\/|native-run-)/.test(ref)){
      throw Error(`Invalid hosted formal evidence path: ${ref}`);
    }
    if(refs.size>=maxEvidenceFiles||refs.has(ref))throw Error(`Excessive or duplicate hosted formal evidence: ${ref}`);
    refs.add(ref);
  };
  for(const model of config.formal?.models??[]){
    add(model.report);
    if(model.witnesses?.length||model.mutants?.length)add(adequacyReportRef(model));
    if(model.conformanceReport)add(model.conformanceReport);
    if(model.checks.includes('run')){
      add(traceReceiptRef(model));
      const directory=traceDirectory(model);
      for(let index=0;index<model.minTraces;index++)add(`${directory}/trace_${index}.itf.json`);
    }
  }
  for(const ref of refs){
    const parts=ref.split('/');
    while(parts.length>1){
      parts.pop();
      if(refs.has(parts.join('/')))throw Error(`Overlapping hosted formal evidence paths: ${ref}`);
    }
  }
  return refs;
}
