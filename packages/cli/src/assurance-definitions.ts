import {hash,hashBytes,type AssuranceConfig,type AssuranceTarget,type Config} from '@behavproof/core';
import {git,readGitFile} from './project.js';
import {assuranceCriterionPaths} from './assurance-inputs.js';

/** The reviewed configuration selects executable conditions and their checks. */
export function assuranceDefinitions(selection:AssuranceConfig|undefined,configRef:string):AssuranceTarget[]|undefined{
  return selection?.definitions?.map(({id,definition})=>({id,sourceRef:configRef,
    revisionHash:hash({schemaVersion:2,id,definition}),assurance:definition}));
}

export async function assuranceCriteriaAt(root:string,config:Config,configRef:string,commit:string){
  const targets=assuranceDefinitions(config.assurance,configRef);
  if(!targets||!config.assurance)return undefined;
  const files=(await git(root,['ls-tree','-r','--name-only','-z',commit])).split('\0').filter(Boolean);
  return Object.fromEntries(await Promise.all(assuranceCriterionPaths(config.assurance,targets,files)
    .map(async ref=>[ref,hashBytes(await readGitFile(root,commit,ref))])));
}
