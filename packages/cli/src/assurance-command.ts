import {randomUUID}from'node:crypto';import{execFile}from'node:child_process';import{fileURLToPath}from'node:url';
import {hash,safeReadJson,canonicalJson,AssuranceBundleSchema,AssuranceConfigSchema}from'@behavproof/core';
import {buildAssuranceMap,renderAssuranceMap}from'@behavproof/spec-registry';
import{config,fileList,writeScoped}from'./project.js';
import{assuranceDefinitions}from'./assurance-definitions.js';
import{assuranceIdentity}from'./assurance-inputs.js';import{check}from'./check.js';
export async function executeAssurance(root:string,action:string,values:Record<string,unknown>){
 const configRef=typeof values.config==='string'?values.config:'behavproof.config.json',cfg=await config(root,configRef),files=await fileList(root);
 const targets=assuranceDefinitions(cfg.assurance,configRef)??[];
 if(action==='discover')return {exitCode:0,text:canonicalJson({definitions:targets,notice:'Static assurance inventory.'})+'\n'};
 if(action==='map'){
  const report=typeof values['trust-root']==='string'?await check(root,{mode:'audit',base:typeof values.base==='string'?values.base:'HEAD','trust-root':values['trust-root'],config:configRef}):undefined;
  const map=report?.assuranceMap??buildAssuranceMap(targets),format=values.format??'markdown',rendered=renderAssuranceMap(map);
  if(!['console','markdown','json','html'].includes(String(format)))throw Error('Unsupported assurance map format');
  return {exitCode:0,text:rendered[format==='json'?'json':format==='html'?'html':'markdown']};
 }
 if(action!=='run')throw Error('Expected assurance discover|run|map');
 if(values.output||values['trust-root']||values.mode)throw Error('assurance run writes only its configured report; output and gate authority options belong to map/check');
 const selection=AssuranceConfigSchema.parse(cfg.assurance);
 if(!targets.length)throw Error('No assurance conditions adopted');
 const before=await assuranceIdentity(root,selection,targets,files,configRef);
 if(!selection.report.startsWith('.behavproof/')||before.paths.includes(selection.report))throw Error('Assurance report must be a non-overlapping managed .behavproof/ path');
 const fresh=`.behavproof/assurance-runs/${randomUUID()}.json`,worker=fileURLToPath(new URL('./assurance-worker.js',import.meta.url));
 const result=await new Promise<{code:number;stderr:string}>((resolve,reject)=>{
  execFile(process.execPath,[worker,root,configRef,fresh],{cwd:root,timeout:selection.timeoutMs??60000,maxBuffer:1024*1024,encoding:'utf8'},(error,_,stderr)=>{
   if(error&&((error as any).killed||!Number.isInteger((error as any).code)||![0,1].includes((error as any).code)))reject(Error(`Assurance execution incomplete: ${stderr||error.message}`));else resolve({code:error?Number((error as any).code):0,stderr});
  });
 });
 const bundle=AssuranceBundleSchema.parse(await safeReadJson(root,fresh));
 const after=await assuranceIdentity(root,selection,targets,await fileList(root),configRef);if(hash(before)!==hash(after))throw Error('Assurance source snapshot changed');
 if(bundle.reports.some(r=>hash(r.subject)!==hash(before.subject)||hash(r.inputHashes)!==hash(before.inputHashes)))throw Error('Worker report identity mismatch');
 await writeScoped(root,selection.report,canonicalJson(bundle)+'\n');
 return {exitCode:result.code,text:canonicalJson({report:selection.report,definitions:bundle.reports.map(r=>({id:r.definitionId,revisionHash:r.revisionHash})),notice:'Authenticate report bytes with a protected Collector before using them as gate evidence.'})+'\n'};
}
