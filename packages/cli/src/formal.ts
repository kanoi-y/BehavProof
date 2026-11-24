import {randomUUID}from'node:crypto';import{dirname,join}from'node:path';import{fileURLToPath}from'node:url';
import{formalInvariants,formalSelection,formalMutantModel,specificationRevision,safeRead,safeReadJson,hash,hashBytes,canonicalJson,FormalModelConfigSchema,FormalModelReportSchema,FormalTraceReceiptSchema,ModelConformanceReportSchema,type FormalModelConfig,type FormalInputIdentity}from'@behavproof/core';
import{config,fileList,writeScoped,exists}from'./project.js';
import{executeFormalAdequacy}from'./formal-adequacy.js';
export const traceReceiptRef=(m:FormalModelConfig)=>m.traceReceipt??`${m.report}.traces.json`;
export const traceDirectory=(m:FormalModelConfig)=>m.traceDirectory??join(dirname(m.report),`${hash({id:m.id}).slice(0,16)}.traces`).replaceAll('\\','/');
export const replayCommandHash=(m:FormalModelConfig,toolHash?:string)=>hash({adapter:'@behavproof/adapter-model-test/1',nodeMajor:24,model:m,...(toolHash?{toolHash}:{})});
export async function formalAdapters(){
 try{return {quint:await import('@behavproof/adapter-quint'),replay:await import('@behavproof/adapter-model-test')};}
 catch(error){if((error as NodeJS.ErrnoException).code==='ERR_MODULE_NOT_FOUND'||(error as NodeJS.ErrnoException).code==='MODULE_NOT_FOUND')throw Error('Optional formal adapters unavailable; explicitly install @behavproof/adapter-quint and @behavproof/adapter-model-test');throw error;}
}
async function formalSourceHash(paths:string[],read:(path:string)=>Promise<Uint8Array>){
 const out:Record<string,string>=Object.create(null);
 for(const ref of [...new Set(paths)].sort())out[ref]=hashBytes(await read(ref));
 return hash(out);
}
export async function formalSpecificationIdentity(root:string,m:FormalModelConfig,read=(path:string):Promise<Uint8Array>=>safeRead(root,path)){
 const {quint}=await formalAdapters(),sources=await quint.readModelInputs(root,m,read);
 const driverHash=m.driver?await formalSourceHash([m.driver,...(m.driverSources??[])],read):undefined;
 const toolHash=!m.quint.entry.startsWith('node_modules/')?hashBytes(await read(m.quint.entry)):undefined;
 const mutantHashes:Record<string,string>=Object.create(null),mutantSources=new Set<string>();
 for(const mutant of m.mutants??[]){
  const variant=await quint.readModelInputs(root,formalMutantModel(m,mutant),read);
  mutantHashes[mutant.id]=variant.modelHash;
  for(const path of Object.keys(variant.sources))mutantSources.add(path);
 }
 return {...sources,commandHash:quint.quintCommandHash(m,toolHash),...(driverHash?{driverHash}:{}),...(toolHash?{toolHash}:{}),
  ...(m.mutants?.length?{mutantHashes,mutantSources:[...mutantSources].sort()}:{}),
 };
}
export async function formalInputIdentity(root:string,m:FormalModelConfig){
 const read=(path:string)=>safeRead(root,path);
 const {driverHash,toolHash,sources,modelHash,commandHash,mutantHashes,mutantSources}=await formalSpecificationIdentity(root,m,read);
 const sourceMap=(paths:string[])=>formalSourceHash(paths,read);
 const implementation=m.implementation?await sourceMap([m.implementation,...m.implementationSources]):undefined;
 const canary=m.canary?await sourceMap([m.canary.implementation,...m.implementationSources,...(m.implementation?[m.implementation]:[])]):undefined;
 return {model:{modelHash,configHash:hash(m),commandHash},sources,...(driverHash?{driverHash}:{}),...(implementation?{implementationHash:implementation}:{}),...(canary?{canaryImplementationHash:canary}:{}),...(toolHash?{toolHash}:{}),
  ...(mutantHashes&&mutantSources?{mutantHashes,mutantSources}:{}),
 };
}
export async function formalTraceInputs(root:string,m:FormalModelConfig,readJson:(ref:string)=>Promise<unknown>=ref=>safeReadJson(root,ref),readBytes:(ref:string)=>Promise<Uint8Array>=ref=>safeRead(root,ref)){
 const {replay}=await formalAdapters(),receipt=FormalTraceReceiptSchema.parse(await readJson(traceReceiptRef(m))),current=await formalSpecificationIdentity(root,m);
 if(receipt.modelId!==m.id||receipt.identity.modelHash!==current.modelHash||receipt.identity.configHash!==hash(m)||receipt.identity.commandHash!==current.commandHash||receipt.toolVersion!==m.quint.version||receipt.maxSteps!==m.maxSteps||receipt.maxSamples!==m.maxSamples||receipt.seed!==m.seed)throw Error('Trace generation/model/config identity mismatch');
 const prefix=traceDirectory(m)+'/',traces=[];
 for(const a of receipt.traces){
  if(!a.ref.startsWith(prefix)||!/^trace_\d+\.itf\.json$/.test(a.ref.slice(prefix.length)))throw Error('Trace artifact outside configured trace directory');
  const bytes=await readBytes(a.ref);if(hashBytes(bytes)!==a.sha256)throw Error('Trace artifact digest mismatch');
  traces.push(replay.readITF(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),{id:a.ref.slice(prefix.length)}));
 }
 return {receipt,traces,traceHash:hash(traces)};
}
async function discoverFormal(root:string,models:FormalModelConfig[],files:string[]){
 const rows=[];
 for(const m of models){
  const base={id:m.id,model:m.model,properties:formalInvariants(m),maxSteps:m.maxSteps,seed:m.seed,
   missing:[m.model,...m.modelSources,...(m.driver?[m.driver]:[]),...(m.implementation?[m.implementation]:[])].filter(p=>!files.includes(p))};
  const selection=formalSelection(m);
  try{
   const {quint}=await formalAdapters();
   const inspected=await quint.inspectQuintModel(root,m);
   const info={...base,selection,sources:inspected.sources,modules:inspected.inventory?.modules??[],diagnostics:inspected.diagnostics};
   if(inspected.status!=='pass'){rows.push({...info,status:inspected.status});continue;}
   const current=await formalInputIdentity(root,m);
   if(inspected.modelHash!==current.model.modelHash)throw Error('Model inputs changed during discovery');
   rows.push({...info,status:'pass' as const,revisionHash:specificationRevision(m,{
    modelHash:inspected.modelHash,...current,
   })});
  }catch(error){rows.push({...base,selection,status:'unknown' as const,diagnostics:[(error as Error).message]});}
 }
 return {exitCode:rows.some(row=>row.status==='unknown')?2:rows.some(row=>row.status==='fail')?1:0,
  report:{models:rows,discovered:files.filter(p=>p.endsWith('.qnt')),notice:'Configured Quint modules are typechecked for inventory. No Driver or implementation was executed.'}};
}
export async function executeFormal(root:string,action:string,values:Record<string,unknown>,toolRoot=root){
 const cfg=await config(root,values.config as string|undefined,values.profile as string|undefined),files=await fileList(root),models=cfg.formal?.models??[];
 if(action==='discover'){
  const selected=models.filter(m=>!values.model||m.model===values.model||m.id===values.model);
  if(values.model&&selected.length!==1)throw Error('Select one configured formal model with --model');
  return discoverFormal(root,selected,files);
 }
 if(!['check','replay','adequacy'].includes(action))throw Error('Expected formal discover|check|replay|adequacy');
 const selected=models.filter(m=>!values.model||m.model===values.model||m.id===values.model);if(!selected.length||values.model&&selected.length!==1)throw Error('Select a configured formal model with --model; formal support is opt-in');
 if(action==='adequacy')return executeFormalAdequacy(root,selected,toolRoot);
 const {quint}=await formalAdapters(),results=[];let exitCode=0;
 for(const m of selected){
  if(action==='check'){
   const stages=[],before=await formalInputIdentity(root,m),runId=randomUUID();
   for(const stage of m.checks){const result=await quint.runQuint({root,toolRoot,model:m,stage,outputDirectory:`.behavproof/formal-runs/${runId}/${stage}`});stages.push(result.result);
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
