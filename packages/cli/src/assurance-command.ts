import {randomUUID}from'node:crypto';import{execFile}from'node:child_process';import{fileURLToPath}from'node:url';
import {hash,safeReadJson,canonicalJson,AssuranceBundleSchema,AssuranceConfigSchema}from'@behavproof/core';
import {buildAssuranceMap,renderAssuranceMap}from'@behavproof/contract-registry';
import{config,fileList,registry,git,writeScoped}from'./project.js';
import{assuranceIdentity}from'./assurance-inputs.js';import{check}from'./check.js';
export async function executeAssurance(root:string,action:string,values:Record<string,unknown>){
 const configRef=typeof values.config==='string'?values.config:'behavproof.config.json',cfg=await config(root,configRef),files=await fileList(root),sha=(await git(root,['rev-parse','HEAD'])).trim(),current=await registry(root,cfg,files,sha);
 if(action==='discover')return {exitCode:0,text:canonicalJson({contracts:current.contracts.filter(c=>c.assurance).map(c=>({id:c.id,revisionHash:c.revisionHash,assurance:c.assurance})),diagnostics:current.discoveryDiagnostics,notice:'Static declarations only; no driver, target, generator or adapter executed.'})+'\n'};
 if(action==='map'){
  const report=typeof values['trust-root']==='string'?await check(root,{mode:'audit',base:typeof values.base==='string'?values.base:'HEAD','trust-root':values['trust-root'],config:configRef}):undefined;
  const map=report?.assuranceMap??buildAssuranceMap(current.contracts),format=values.format??'markdown',rendered=renderAssuranceMap(map);
  if(!['console','markdown','json','html'].includes(String(format)))throw Error('Unsupported assurance map format');
  return {exitCode:0,text:rendered[format==='json'?'json':format==='html'?'html':'markdown']};
 }
 if(action!=='run')throw Error('Expected assurance discover|run|map');
 if(values.output||values['trust-root']||values.mode)throw Error('assurance run writes only its configured report; output and gate authority options belong to map/check');
 const selection=AssuranceConfigSchema.parse(cfg.assurance);
 if(current.discoveryDiagnostics?.length)throw Error('Assurance discovery is incomplete');
 if(!current.contracts.some(c=>c.assurance))throw Error('No assurance conditions adopted');
 const before=await assuranceIdentity(root,selection,current.contracts,files,configRef);
 if(!selection.report.startsWith('.behavproof/')||before.paths.includes(selection.report))throw Error('Assurance report must be a non-overlapping managed .behavproof/ path');
 const fresh=`.behavproof/assurance-runs/${randomUUID()}.json`,worker=fileURLToPath(new URL('./assurance-worker.js',import.meta.url));
 const result=await new Promise<{code:number;stderr:string}>((resolve,reject)=>{
  execFile(process.execPath,[worker,root,configRef,fresh],{cwd:root,timeout:selection.timeoutMs??60000,maxBuffer:1024*1024,encoding:'utf8'},(error,_,stderr)=>{
   if(error&&((error as any).killed||!Number.isInteger((error as any).code)||![0,1].includes((error as any).code)))reject(Error(`Assurance execution incomplete: ${stderr||error.message}`));else resolve({code:error?Number((error as any).code):0,stderr});
  });
 });
 const bundle=AssuranceBundleSchema.parse(await safeReadJson(root,fresh));
 const after=await assuranceIdentity(root,selection,current.contracts,await fileList(root),configRef);if(hash(before)!==hash(after))throw Error('Assurance source snapshot changed');
 if(bundle.reports.some(r=>hash(r.subject)!==hash(before.subject)||hash(r.inputHashes)!==hash(before.inputHashes)))throw Error('Worker report identity mismatch');
 await writeScoped(root,selection.report,canonicalJson(bundle)+'\n');
 return {exitCode:result.code,text:canonicalJson({report:selection.report,contracts:bundle.reports.map(r=>({id:r.contractId,revisionHash:r.revisionHash})),notice:'Explicit local execution. Authenticate report bytes with a protected Collector before using them as gate evidence.'})+'\n'};
}
