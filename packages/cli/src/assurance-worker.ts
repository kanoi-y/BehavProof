import {pathToFileURL} from 'node:url';import{join}from'node:path';
import {hash,canonicalJson,safeRead,hashBytes,AssuranceConfigSchema,evaluateAssuranceConditions}from'@behavproof/core';
import {runAssurance}from'@behavproof/spec-registry';
import {config,fileList,writeScoped}from'./project.js';
import {assuranceIdentity}from'./assurance-inputs.js';
import {assuranceDefinitions}from'./assurance-definitions.js';
async function main(){
 const [root,configRef,output,commit]=process.argv.slice(2);if(!root||!configRef||!output||commit!==undefined&&!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid Assurance worker arguments');
 const cfg=await config(root,configRef),selection=AssuranceConfigSchema.parse(cfg.assurance),files=await fileList(root);
 const targets=assuranceDefinitions(selection,configRef)??[];
 const before=await assuranceIdentity(root,selection,targets,files,configRef,commit);
 await safeRead(root,selection.driver);const driver=await import(pathToFileURL(join(root,selection.driver)).href);
 const bundle=await runAssurance({root,targets:targets,subject:before.subject,inputHashes:before.inputHashes,implementationSources:selection.implementationSources,driver});
 const after=await assuranceIdentity(root,selection,targets,await fileList(root),configRef,commit);if(hash(before)!==hash(after))throw Error('Assurance inputs changed during execution');
 await writeScoped(root,output,canonicalJson(bundle)+'\n',true);
 const results=[];
 for(const report of bundle.reports){
  const definition=targets.find(c=>c.id===report.definitionId&&c.revisionHash===report.revisionHash)!;
  const media=report.checks.flatMap(c=>c.method==='journey'?c.media:[]);
  const authenticatedMedia=Object.fromEntries(await Promise.all(media.map(async m=>[m.ref,hashBytes(await safeRead(root,m.ref))])));
  results.push(evaluateAssuranceConditions(definition.assurance!,[report],{definitionId:definition.id,revisionHash:definition.revisionHash,subject:before.subject,inputHashes:before.inputHashes,implementationSources:selection.implementationSources,checkHashes:Object.fromEntries(definition.assurance!.checks.map(c=>[c.id,hash(c)])),authenticatedReportHashes:[hash(report)],authenticatedMedia}));
 }

 // Local success means collection/evaluation only; no external authority is granted.
 return results.length&&results.every(r=>r.status==='pass')?0:1;
}
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`Assurance worker: ${(error as Error).message}\n`);process.exitCode=2;});
