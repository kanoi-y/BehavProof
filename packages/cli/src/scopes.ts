import { getProfilePolicy, resolveRisk, mergeProtectedPolicy, type Config, type Policy, type Evaluation, type EvidenceStatus } from '@behavproof/core';
import { evaluateCoverage, evaluateMutation, type CoverageReport, type MutationReport, type Scope } from '@behavproof/adapter-reports';
import { matchesGlob } from 'node:path';
import {impactSeverity} from './impact.js';
const scopedRules=new Set(['testResult','changedLineCoverage','mutationScore','pipelineIntegrity','changeImpact','policyProtection']);
type State={status:EvidenceStatus;message:string;evidenceIds:string[];remediation?:string};
export function scopedEvaluations(input:{config:Config;protectedConfig?:Config;policy:Policy;files:readonly string[];states:ReadonlyMap<string,State>;coverage?:CoverageReport;mutation?:MutationReport;coverageTrusted:boolean;mutationTrusted:boolean;mapping:boolean;changed:Scope;sources:Readonly<Record<string,string>>}){
 const overrides=[...input.config.riskOverrides,...(input.protectedConfig?.riskOverrides??[])];
 const contexts=input.files.map(path=>({path,module:path.replace(/\.[cm]?[jt]sx?$/,'')})).filter(({path,module})=>
  overrides.some(({selector})=>selector.kind==='module'?selector.value===module:selector.kind==='path'&&matchesGlob(path,selector.value)));
 const result:Evaluation[]=[];
 for(const target of contexts){
  const protectedRisk=input.protectedConfig?resolveRisk(input.protectedConfig,target):undefined,risk=resolveRisk(input.config,target,protectedRisk),profile=getProfilePolicy(risk);
  // Risk selects mandatory obligations; numerical parameters come from the
  // already merged project/protected policy rather than reapplying preset defaults.
  for(const [id,rule] of Object.entries(profile.rules)){const configured=input.policy.rules[id];if(configured?.min!==undefined)rule.min=configured.min;if(configured?.minMutants!==undefined)rule.minMutants=configured.minMutants;if(configured?.allowNotApplicable)rule.allowNotApplicable=configured.allowNotApplicable;}
  const effective=mergeProtectedPolicy(input.policy,profile);
  effective.rules.changeImpact={severity:impactSeverity(risk,effective.rules.changeImpact)};
  const facts=new Map(input.states),scope=Object.fromEntries(Object.entries(input.changed).filter(([path])=>path===target.path));
  if(input.coverage){const evaluation=evaluateCoverage(input.coverage,scope,effective.rules.changedLineCoverage?.min??80,{},input.mapping);facts.set('changedLineCoverage',{status:input.coverageTrusted?evaluation.status:'unknown',message:`Scoped changed lines: ${JSON.stringify(evaluation.payload)}`,evidenceIds:[]});}
  else facts.set('changedLineCoverage',{status:'unknown',message:'Scoped coverage unavailable',evidenceIds:[]});
  if(input.mutation){const p=effective.rules.mutationScore,evaluation=evaluateMutation(input.mutation,scope,p?.min??70,p?.minMutants??10,input.sources,input.mapping);facts.set('mutationScore',{status:input.mutationTrusted?evaluation.status:'unknown',message:`Scoped mutants: ${JSON.stringify(evaluation.payload)}`,evidenceIds:[]});}
  else facts.set('mutationScore',{status:'unknown',message:'Scoped mutation data unavailable',evidenceIds:[]});
  for(const [ruleId,rule] of Object.entries(effective.rules)){
   if(!scopedRules.has(ruleId))continue;
   const fact=facts.get(ruleId);result.push({ruleId,severity:rule.severity,status:fact?.status??'unknown',scope:['path',target.path],evidenceIds:fact?.evidenceIds??[],message:fact?.message??`Evidence unavailable for ${risk} scope`,...(fact?.remediation?{remediation:fact.remediation}:{})});
  }
 }
 return result;
}
