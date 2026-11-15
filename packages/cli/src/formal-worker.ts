import{pathToFileURL}from'node:url';import{join}from'node:path';
import{safeRead,hash,canonicalJson,FormalModelConfigSchema,evaluateModelConformance,type FormalInputIdentity}from'@behavproof/core';
import{formalInputIdentity,formalTraceInputs,replayCommandHash,formalAdapters}from'./formal.js';
import{writeScoped}from'./project.js';
async function main(){
 const root=process.argv[2];if(!root)throw Error('Replay root unavailable');
 const m=FormalModelConfigSchema.parse(JSON.parse(process.argv[3]??'null'));
 if(!m.driver||!m.implementation||!m.conformanceReport)throw Error('Incomplete replay selection');
 const before=await formalInputIdentity(root,m),trace=await formalTraceInputs(root,m);
 const load=async(ref:string)=>{await safeRead(root,ref);return import(pathToFileURL(join(root,ref)).href);};
 const driver=await load(m.driver),implementation=await load(m.implementation);
 if(typeof driver.createDriver!=='function')throw Error('Driver must export createDriver(implementation)');
 const identity:FormalInputIdentity={...before.model,commandHash:replayCommandHash(m),driverHash:before.driverHash!,implementationHash:before.implementationHash!,traceHash:trace.traceHash};
 const {replay}=await formalAdapters();
 const report=await replay.replayTraces({modelId:m.id,identity,traces:trace.traces,implementation,createDriver:driver.createDriver,...(m.canary?{canary:{faultId:m.canary.faultId,implementationHash:before.canaryImplementationHash!,implementation:await load(m.canary.implementation)}}:{})});
 if(hash(before)!==hash(await formalInputIdentity(root,m))||trace.traceHash!==(await formalTraceInputs(root,m)).traceHash)throw Error('Replay inputs changed during execution');
 const output=process.argv[4];if(!output)throw Error('Fresh replay output required');
 await writeScoped(root,output,canonicalJson(report)+'\n',true);
 const evaluation=evaluateModelConformance(report,{model:m,identity,authenticated:true,...(before.canaryImplementationHash?{canaryImplementationHash:before.canaryImplementationHash}:{})});
 process.stdout.write(canonicalJson({status:evaluation.status,scope:evaluation.scope,counts:evaluation.counts})+'\n');return evaluation.status==='pass'?0:1;
}
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`Formal replay: ${(error as Error).message}\n`);process.exitCode=2;});
