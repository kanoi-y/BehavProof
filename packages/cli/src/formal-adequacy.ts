import {randomUUID} from 'node:crypto';
import {canonicalJson, DEFAULT_FORMAL_BACKEND_VERSION, FormalAdequacyReportSchema, formalMutantCommandHash,
  formalMutantModel, formalWitnessCommandHash, hash,
  type FormalModelConfig, type FormalMutantEvidence, type FormalWitnessEvidence} from '@behavproof/core';
import {formalAdapters, formalInputIdentity} from './formal.js';
import {writeScoped} from './project.js';

export const adequacyReportRef=(model:FormalModelConfig)=>model.report+'.adequacy.json';

export async function executeFormalAdequacy(root:string,models:FormalModelConfig[],toolRoot=root){
  const {quint}=await formalAdapters();
  const reports=[];
  for(const model of models){
    if(!model.witnesses?.length&&!model.mutants?.length)continue;
    const before=await formalInputIdentity(root,model);
    const inspected=await quint.inspectQuintModel(root,model,toolRoot);
    if(inspected.status!=='pass'||inspected.modelHash!==before.model.modelHash){
      throw Error(inspected.diagnostics.join(' ')||'Quint witness selections could not be verified');
    }
    const batch=randomUUID();
    const witnesses:FormalWitnessEvidence[]=[];
    for(const [index,name] of (model.witnesses??[]).entries()){
      const checked=await quint.runQuint({root,toolRoot,model,stage:'verify',witness:name,
        outputDirectory:`.behavproof/formal-runs/${batch}/witness-${index}`});
      if(hash(checked.identity)!==hash(before.model))throw Error('Formal witness inputs changed during execution');
      const raw=checked.raw as {trace?:FormalWitnessEvidence['trace']}|undefined;
      const trace=Array.isArray(raw?.trace)?raw.trace:undefined;
      const found=checked.result.status==='fail'&&trace?.length&&trace.length<=model.maxSteps+1;
      const outcome=found?'found':checked.result.status==='pass'&&!trace?.length?'not_found':'unknown';
      witnesses.push({
        name,method:'bounded_model_check',maxSteps:model.maxSteps,
        commandHash:formalWitnessCommandHash(before.model.commandHash,name),outcome,
        ...(found?{trace}:{}),diagnostics:checked.result.diagnostics.slice(0,100),
      });
    }
    const mutants:FormalMutantEvidence[]=[];
    const normal=new Map<string,boolean>();
    for(const [index,mutation] of (model.mutants??[]).entries()){
      const modelHash=before.mutantHashes?.[mutation.id];
      if(!modelHash)throw Error(`Missing source identity for model fault ${mutation.id}`);
      const {id,invariant}=mutation;
      const identity={id,invariant,modelHash};
      const evidence={...identity,maxSteps:model.maxSteps,commandHash:formalMutantCommandHash(before.model.commandHash,identity)};
      const variant=formalMutantModel(model,mutation);
      const variantInspection=await quint.inspectQuintModel(root,variant,toolRoot);
      if(variantInspection.modelHash!==modelHash)throw Error('Model fault inputs changed during execution');
      const fingerprint=inspected.fingerprints?.[invariant];
      const variantFingerprint=variantInspection.fingerprints?.[invariant];
      if(variantInspection.status!=='pass'||!fingerprint||!variantFingerprint||variantFingerprint!==fingerprint){
        const incomplete=variantInspection.status==='unknown'||variantInspection.status==='pass'&&(!fingerprint||!variantFingerprint);
        mutants.push({...evidence,outcome:incomplete?'unknown':'invalid',
          diagnostics:[...variantInspection.diagnostics,'The model fault must typecheck and preserve the selected invariant and its dependencies'].slice(0,100)});
        continue;
      }
      if(!normal.has(invariant)){
        const base=await quint.runQuint({root,toolRoot,model,stage:'verify',invariant,
          outputDirectory:`.behavproof/formal-runs/${batch}/normal-${index}`});
        if(hash(base.identity)!==hash(before.model))throw Error('Normal model inputs changed during execution');
        normal.set(invariant,base.result.status==='pass');
      }
      if(normal.get(invariant)!==true){
        mutants.push({...evidence,outcome:'unknown',diagnostics:['The normal model did not pass the same bounded check']});
        continue;
      }
      const checked=await quint.runQuint({root,toolRoot,model:variant,stage:'verify',invariant,
        outputDirectory:`.behavproof/formal-runs/${batch}/mutant-${index}`});
      if(checked.identity.modelHash!==modelHash)throw Error('Model fault inputs changed during execution');
      const raw=checked.raw as {trace?:FormalMutantEvidence['trace']}|undefined;
      const trace=Array.isArray(raw?.trace)?raw.trace:undefined;
      const detected=checked.result.status==='fail'&&trace?.length&&trace.length<=model.maxSteps+1;
      mutants.push({...evidence,outcome:detected?'detected':checked.result.status==='pass'&&!trace?.length?'survived':'unknown',
        ...(detected?{trace}:{}),diagnostics:checked.result.diagnostics.slice(0,100)});
    }
    if(hash(await formalInputIdentity(root,model))!==hash(before))throw Error('Formal witness inputs changed during execution');
    const report=FormalAdequacyReportSchema.parse({
      schemaVersion:1,modelId:model.id,identity:before.model,
      toolVersion:model.quint.version,backendVersion:model.quint.apalacheVersion??DEFAULT_FORMAL_BACKEND_VERSION,witnesses,
      ...(mutants.length?{mutants}:{}),
    });
    await writeScoped(root,adequacyReportRef(model),canonicalJson(report)+'\n');
    reports.push(report);
  }
  if(!reports.length)throw Error('No configured Quint witnesses or specification mutants selected');
  const outcomes=reports.flatMap(report=>report.witnesses.map(witness=>witness.outcome));
  const faults=reports.flatMap(report=>report.mutants??[]);
  const mutationSummary={detected:0,survived:0,invalid:0,unknown:0};
  for(const fault of faults)mutationSummary[fault.outcome]++;
  return {exitCode:outcomes.includes('not_found')||mutationSummary.survived?1:
    outcomes.includes('unknown')||mutationSummary.invalid||mutationSummary.unknown?2:0,
    report:{models:reports,...(faults.length?{mutationSummary}:{})}};
}
