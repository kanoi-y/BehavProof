import {hashBytes,safeRead,RelativePathSchema,type AssuranceConfig,type AssuranceTarget} from '@behavproof/core';
import {gitSubject,sourceTreeHash} from '@behavproof/adapter-reports';
const sourcePath=(ref:string)=>ref.replace(/:\d+(?::\d+)?$/,'');
export function assuranceInputPaths(configuration:AssuranceConfig,targets:readonly AssuranceTarget[],files:readonly string[],configRef:string){
 const selected=new Set(['package.json',...configuration.driverSources,...configuration.implementationSources]);
 for(const c of targets){if(!c.assurance)continue;selected.add(sourcePath(c.sourceRef));
  for(const check of c.assurance.checks){
   if(check.method==='architecture')for(const ref of check.files)selected.add(ref);else selected.add(check.targetRef.split('#')[0]!);
   if(check.method==='property')for(const ref of [check.generator,check.predicate,...(check.shrinker?[check.shrinker]:[])])selected.add(ref);
   if(check.method==='sequence')for(const ref of [check.generator,check.model,check.projection])selected.add(ref);
   if(check.method==='effects')for(const resource of check.resources)selected.add(resource.adapter);
   if(check.method==='journey')for(const binding of check.layerBindings)selected.add(binding.adapter);
  }
  for(const fault of c.assurance.conditions.flatMap(condition=>condition.requiredFaults))selected.add(fault.implementation);
 }
 for(const ref of [configRef,'package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock',...files.filter(f=>/(?:^|\/)tsconfig[^/]*\.json$/.test(f))])if(files.includes(ref))selected.add(ref);
 return [...selected].map(ref=>RelativePathSchema.parse(ref)).sort();
}
export async function assuranceIdentity(root:string,configuration:AssuranceConfig,targets:readonly AssuranceTarget[],files:readonly string[],configRef:string,testedCommitSha?:string){
 const paths=assuranceInputPaths(configuration,targets,files,configRef),inputHashes:Record<string,string>=Object.create(null);
 if(!paths.length)throw Error('Assurance input inventory is empty');
 for(const path of paths)inputHashes[path]=hashBytes(await safeRead(root,path));
 const subject=testedCommitSha?{testedCommitSha,sourceTreeHash:await sourceTreeHash(root,paths)}:await gitSubject(root,paths);
 return {paths,inputHashes,subject:{testedCommitSha:subject.testedCommitSha,sourceTreeHash:subject.sourceTreeHash}};
}

/** Verification semantics are independently pinned; production targets may change
 * under the same approved conditions, but generators/oracles/adapters may not. */
export function assuranceCriterionPaths(configuration:AssuranceConfig,targets:readonly AssuranceTarget[],files:readonly string[]){
 const criteria=new Set(['package.json',...configuration.driverSources]);
 for(const c of targets){if(!c.assurance)continue;
  for(const check of c.assurance.checks){
   if(check.method==='property')for(const ref of [check.generator,check.predicate,...(check.shrinker?[check.shrinker]:[])])criteria.add(ref);
   if(check.method==='sequence')for(const ref of [check.generator,check.model,check.projection])criteria.add(ref);
   if(check.method==='effects')for(const r of check.resources)criteria.add(r.adapter);
   if(check.method==='journey')for(const b of check.layerBindings)criteria.add(b.adapter);
  }
  for(const f of c.assurance.conditions.flatMap(c=>c.requiredFaults))criteria.add(f.implementation);
 }
 for(const ref of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock',...files.filter(f=>/(?:^|\/)tsconfig[^/]*\.json$/.test(f))])if(files.includes(ref))criteria.add(ref);
 return [...criteria].map(ref=>RelativePathSchema.parse(ref)).sort();
}
