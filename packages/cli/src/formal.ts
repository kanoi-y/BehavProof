import {randomUUID}from'node:crypto';import{dirname,join}from'node:path';import{fileURLToPath}from'node:url';
import{safeRead,safeReadJson,hash,hashBytes,canonicalJson,FormalModelConfigSchema,FormalModelReportSchema,FormalTraceReceiptSchema,ModelConformanceReportSchema,type FormalModelConfig,type FormalInputIdentity}from'@behavproof/core';
import{config,fileList,writeScoped,exists}from'./project.js';
export const traceReceiptRef=(m:FormalModelConfig)=>m.traceReceipt??`${m.report}.traces.json`;
export const traceDirectory=(m:FormalModelConfig)=>m.traceDirectory??`${dirname(m.report)}/${hash({id:m.id}).slice(0,16)}.traces`;
export const replayCommandHash=(m:FormalModelConfig)=>hash({adapter:'@behavproof/adapter-model-test/1',nodeMajor:24,model:m});
export async function formalAdapters(){
 try{return {quint:await import('@behavproof/adapter-quint'),replay:await import('@behavproof/adapter-model-test')};}
 catch(error){if((error as NodeJS.ErrnoException).code==='ERR_MODULE_NOT_FOUND'||(error as NodeJS.ErrnoException).code==='MODULE_NOT_FOUND')throw Error('Optional formal adapters unavailable; explicitly install @behavproof/adapter-quint and @behavproof/adapter-model-test');throw error;}
}
export async function formalInputIdentity(root:string,m:FormalModelConfig){
 const {quint}=await formalAdapters(),sources=await quint.readModelInputs(root,m);
 const sourceMap=async(paths:string[])=>{const out:Record<string,string>=Object.create(null);for(const ref of [...new Set(paths)].sort())out[ref]=hashBytes(await safeRead(root,ref));return out;};
 const driver=m.driver?hash(await sourceMap([m.driver,...(m.driverSources??[])])):undefined;
 const implementation=m.implementation?hash(await sourceMap([m.implementation,...m.implementationSources])):undefined;
 const canary=m.canary?hash(await sourceMap([m.canary.implementation,...m.implementationSources,...(m.implementation?[m.implementation]:[])])):undefined;
 return {model:{modelHash:sources.modelHash,configHash:hash(m),commandHash:quint.quintCommandHash(m)},driverHash:driver,implementationHash:implementation,canaryImplementationHash:canary};
}
export async function formalTraceInputs(root:string,m:FormalModelConfig,readJson:(ref:string)=>Promise<unknown>=ref=>safeReadJson(root,ref),readBytes:(ref:string)=>Promise<Uint8Array>=ref=>safeRead(root,ref)){
 const {replay,quint}=await formalAdapters(),receipt=FormalTraceReceiptSchema.parse(await readJson(traceReceiptRef(m))),current=await quint.readModelInputs(root,m);
 if(receipt.modelId!==m.id||receipt.identity.modelHash!==current.modelHash||receipt.identity.configHash!==hash(m)||receipt.identity.commandHash!==quint.quintCommandHash(m)||receipt.toolVersion!==m.quint.version||receipt.maxSteps!==m.maxSteps||receipt.maxSamples!==m.maxSamples||receipt.seed!==m.seed)throw Error('Trace generation/model/config identity mismatch');
 const prefix=traceDirectory(m)+'/',traces=[];
 for(const a of receipt.traces){
  if(!a.ref.startsWith(prefix)||!/^trace_\d+\.itf\.json$/.test(a.ref.slice(prefix.length)))throw Error('Trace artifact outside configured trace directory');
  const bytes=await readBytes(a.ref);if(hashBytes(bytes)!==a.sha256)throw Error('Trace artifact digest mismatch');
  traces.push(replay.readITF(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),{id:a.ref.slice(prefix.length)}));
 }
 return {receipt,traces,traceHash:hash(traces)};
}
export async function executeFormal(root:string,action:string,values:Record<string,unknown>){
 const cfg=await config(root,values.config as string|undefined,values.profile as string|undefined),files=await fileList(root),models=cfg.formal?.models??[];
 if(action==='discover')return {exitCode:0,report:{models:models.map(m=>({id:m.id,model:m.model,contractId:m.contractId,properties:m.properties,maxSteps:m.maxSteps,seed:m.seed,missing:[m.model,...m.modelSources,...(m.driver?[m.driver]:[]),...(m.implementation?[m.implementation]:[])].filter(p=>!files.includes(p))})),discovered:files.filter(p=>p.endsWith('.qnt')),notice:'Static inventory only; no model, Driver or tool was executed.'}};
 if(!['check','replay'].includes(action))throw Error('Expected formal discover|check|replay');
 const selected=models.filter(m=>!values.model||m.model===values.model||m.id===values.model);if(!selected.length||values.model&&selected.length!==1)throw Error('Select a configured formal model with --model; formal support is opt-in');
 const {quint}=await formalAdapters(),results=[];let exitCode=0;
 for(const m of selected){
  if(action==='check'){
   const stages=[],before=await formalInputIdentity(root,m),runId=randomUUID();
   for(const stage of m.checks){const result=await quint.runQuint({root,model:m,stage,outputDirectory:`.behavproof/formal-runs/${runId}/${stage}`});stages.push(result.result);
    if(stage==='run'&&result.result.status==='pass'){
     const traces=[];for(const artifact of result.result.artifacts??[]){if(!/\/trace_\d+\.itf\.json$/.test(artifact.ref))continue;const ref=`${traceDirectory(m)}/${artifact.ref.split('/').at(-1)}`,bytes=await safeRead(root,artifact.ref);await writeScoped(root,ref,new TextDecoder('utf-8',{fatal:true}).decode(bytes));traces.push({ref,sha256:hashBytes(bytes)});}
     await writeScoped(root,traceReceiptRef(m),canonicalJson({schemaVersion:1,modelId:m.id,identity:result.identity,toolVersion:m.quint.version,backend:'typescript',maxSteps:m.maxSteps,maxSamples:m.maxSamples,seed:m.seed,traces})+'\n');
    }
   }
   if(hash(before)!==hash(await formalInputIdentity(root,m)))throw Error('Formal inputs changed during execution');
   const report=FormalModelReportSchema.parse({schemaVersion:1,modelId:m.id,identity:before.model,stages});await writeScoped(root,m.report,canonicalJson(report)+'\n');results.push(report);
   if(stages.some(s=>s.status==='unknown'))exitCode=2;else if(exitCode===0&&stages.some(s=>s.status==='fail'))exitCode=1;
  }else{
   if(!m.driver||!m.implementation||!m.conformanceReport)throw Error('Model replay requires configured Driver, implementation and conformanceReport');
   const worker=fileURLToPath(new URL('./formal-worker.js',import.meta.url));
   const freshReport=`.behavproof/formal-replays/${randomUUID()}.json`;
   const result=await quint.runBounded(process.execPath,[worker,root,canonicalJson(m),freshReport],{cwd:root,timeoutMs:m.timeoutMs});
   if(!result.completed||result.exitCode!==0&&result.exitCode!==1)throw Error(`Formal replay infrastructure: ${result.diagnostics.join('; ')||result.stderr||'worker did not complete'}`);
   const report=ModelConformanceReportSchema.parse(await safeReadJson(root,freshReport));
   await writeScoped(root,m.conformanceReport,canonicalJson(report)+'\n');results.push(report);if(result.exitCode!==0&&exitCode===0)exitCode=1;
  }
 }
 return {exitCode,report:{models:results,notice:'Explicit local tool/Driver execution. Gate authority and human-approved model meaning require independent authenticated registration.'}};
}
