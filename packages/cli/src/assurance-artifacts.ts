import {RelativePathSchema,type Config} from '@behavproof/core';
import {maxEvidenceFiles} from './evidence-files.js';

export const assuranceEvidenceArtifact='assurance-evidence.json';
export const hostedAssuranceReport='.behavproof/quality-worker-assurance.json';

export function assuranceEvidenceInventory(config:Config){
  const refs=new Set<string>([hostedAssuranceReport]);
  for(const {definition} of config.assurance?.definitions??[]){
    for(const check of definition.checks){
      if(check.method!=='journey')continue;
      for(const ref of check.requiredMedia??[]){
        RelativePathSchema.parse(ref);
        if(!ref.startsWith('.behavproof/assurance-media/'))throw Error('Hosted Assurance media must be under .behavproof/assurance-media/');
        refs.add(ref);
      }
    }
  }
  if(refs.size>maxEvidenceFiles)throw Error('Too many hosted Assurance evidence paths');
  return refs;
}
