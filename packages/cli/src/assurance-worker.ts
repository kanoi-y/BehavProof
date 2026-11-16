import {pathToFileURL} from 'node:url';import{join}from'node:path';
import {hash,canonicalJson,safeRead,hashBytes,AssuranceConfigSchema,evaluateAssuranceConditions}from'@behavproof/core';
import {runAssurance}from'@behavproof/contract-registry';
import {config,fileList,registry,git,writeScoped}from'./project.js';
import {assuranceIdentity}from'./assurance-inputs.js';
async function main(){
 const [root,configRef,output]=process.argv.slice(2);if(!root||!configRef||!output)throw Error('Worker arguments missing');
 const cfg=await config(root,configRef),selection=AssuranceConfigSchema.parse(cfg.assurance),files=await fileList(root),sha=(await git(root,['rev-parse','HEAD'])).trim();
 const current=await registry(root,cfg,files,sha);if(current.discoveryDiagnostics?.length)throw Error('Assurance discovery is incomplete');
 const before=await assuranceIdentity(root,selection,current.contracts,files,configRef);
 await safeRead(root,selection.driver);const driver=await import(pathToFileURL(join(root,selection.driver)).href);
 const bundle=await runAssurance({root,contracts:current.contracts,subject:before.subject,inputHashes:before.inputHashes,implementationSources:selection.implementationSources,driver});
 const after=await assuranceIdentity(root,selection,current.contracts,await fileList(root),configRef);if(hash(before)!==hash(after))throw Error('Assurance inputs changed during execution');
 await writeScoped(root,output,canonicalJson(bundle)+'\n',true);
 const results=[];
 for(const report of bundle.reports){
  const contract=current.contracts.find(c=>c.id===report.contractId&&c.revisionHash===report.revisionHash)!;
  const media=report.checks.flatMap(c=>c.method==='journey'?c.media:[]);
  const authenticatedMedia=Object.fromEntries(await Promise.all(media.map(async m=>[m.ref,hashBytes(await safeRead(root,m.ref))])));
  results.push(evaluateAssuranceConditions(contract.assurance!,[report],{contractId:contract.id,revisionHash:contract.revisionHash,subject:before.subject,inputHashes:before.inputHashes,implementationSources:selection.implementationSources,checkHashes:Object.fromEntries(contract.assurance!.checks.map(c=>[c.id,hash(c)])),authenticatedReportHashes:[hash(report)],authenticatedMedia}));
 }

 // Local success means collection/evaluation only; no external authority is granted.
 return results.length&&results.every(r=>r.status==='pass')?0:1;
}
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`Assurance worker: ${(error as Error).message}\n`);process.exitCode=2;});
