import {z} from 'zod';
import {FormalInputIdentitySchema, type FormalInputIdentity} from './formal.js';
import {hash} from './serialization.js';

const witness = z.strictObject({
  name: z.string().min(1),
  method: z.literal('bounded_model_check'),
  maxSteps: z.number().int().min(1).max(10000),
  commandHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['found','not_found','unknown']),
  trace: z.array(z.json()).max(10001).optional(),
  diagnostics: z.array(z.string()).max(100).optional(),
});
const mutantIdentity=z.strictObject({id:z.string().min(1),invariant:z.string().min(1),
  modelHash:z.string().regex(/^[a-f0-9]{64}$/)});
const mutant=mutantIdentity.extend({
  maxSteps:witness.shape.maxSteps, commandHash:witness.shape.commandHash,
  outcome:z.enum(['detected','survived','invalid','unknown']),trace:witness.shape.trace,
  diagnostics:witness.shape.diagnostics,
});
export const FormalAdequacyReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelId: z.string().min(1),
  identity: FormalInputIdentitySchema,
  toolVersion: z.string().min(1),
  backendVersion: z.string().min(1),
  witnesses: z.array(witness).max(1000).refine(
    rows=>new Set(rows.map(row=>row.name)).size===rows.length,'Duplicate witness evidence',
  ),
  mutants:z.array(mutant).max(100).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,
    'Duplicate specification mutant evidence').optional(),
});
export type FormalWitnessEvidence = z.infer<typeof witness>;
export type FormalMutantEvidence=z.infer<typeof mutant>;
export type FormalMutantIdentity=z.infer<typeof mutantIdentity>;
export const DEFAULT_FORMAL_BACKEND_VERSION='0.62.4';

export const formalWitnessCommandHash = (commandHash:string, name:string) =>
  hash({schemaVersion:1,kind:'quint-witness',commandHash,name});
export const formalMutantCommandHash=(commandHash:string, identity:FormalMutantIdentity)=>
  hash({schemaVersion:1,kind:'quint-mutant',commandHash,...identity});

type ExpectedAdequacy={
  modelId:string; identity:FormalInputIdentity; authenticated:boolean;
  backendVersion:string; toolVersion:string; maxSteps:number;
};
function authenticatedAdequacy(value:unknown,expected:ExpectedAdequacy){
  const parsed=FormalAdequacyReportSchema.safeParse(value);
  const report=parsed.success?parsed.data:undefined;
  const trusted=expected.authenticated&&report?.modelId===expected.modelId&&
    report.backendVersion===expected.backendVersion&&report.toolVersion===expected.toolVersion&&
    hash(report.identity)===hash(expected.identity);

  return trusted?report:undefined;
}
export function evaluateFormalAdequacy(value:unknown,expected:ExpectedAdequacy&{names:readonly string[]}){
  const report=authenticatedAdequacy(value,expected);
  return expected.names.map(name=>{
    const row=report?.witnesses.find(entry=>entry.name===name);
    const matching=row?.maxSteps===expected.maxSteps&&
      row.commandHash===formalWitnessCommandHash(expected.identity.commandHash,name);
    if(matching&&row.outcome==='found'&&row.trace?.length&&row.trace.length<=expected.maxSteps+1){
      return {name,status:'pass' as const,message:`Reached within ${expected.maxSteps} steps`};
    }
    if(matching&&row.outcome==='not_found'&&row.trace===undefined){
      return {name,status:'fail' as const,message:`No witness within the completed bound of ${expected.maxSteps} steps`};
    }
    return {name,status:'unknown' as const,message:matching&&row.diagnostics?.length?
      row.diagnostics.join(' '):'Current authenticated bounded witness evidence is unavailable'};
  });
}
export function evaluateSpecificationMutants(value:unknown,expected:ExpectedAdequacy&{mutants:readonly FormalMutantIdentity[]}){
  const report=authenticatedAdequacy(value,expected);
  return expected.mutants.map(identity=>{
    const row=report?.mutants?.find(entry=>entry.id===identity.id);
    const matching=row?.maxSteps===expected.maxSteps&&row.modelHash===identity.modelHash&&
      row.invariant===identity.invariant&&row.commandHash===formalMutantCommandHash(expected.identity.commandHash,identity);
    if(matching&&row.outcome==='detected'&&row.trace?.length&&row.trace.length<=expected.maxSteps+1){
      return {id:identity.id,status:'pass' as const,message:'The approved invariant detected the specified model fault'};
    }
    if(matching&&row.outcome==='survived'&&row.trace===undefined){
      return {id:identity.id,status:'fail' as const,message:'The specified model fault survived the completed bounded check'};
    }
    return {id:identity.id,status:'unknown' as const,
      message:matching&&row.diagnostics?.length?row.diagnostics.join(' '):'Current authenticated mutation evidence is unavailable'};
  });
}
