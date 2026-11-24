import { DEFAULT_FORMAL_BACKEND_VERSION, formalInvariants, formalSelection, FormalModelConfigSchema, FormalStageResultSchema, type FormalModelConfig, type FormalStage, type FormalStageResult } from '@behavproof/core';
import { discoverQuintDefinitions } from './discovery.js';
export const QUINT_VERSION='0.33.1';
export const APALACHE_VERSION=DEFAULT_FORMAL_BACKEND_VERSION;
const stages={parse:'parsing',typecheck:'typechecking',test:'testing',run:'running',verify:'verifying'};
const methods={parse:'parse',typecheck:'typecheck',test:'spec_test',run:'simulation',verify:'bounded_model_check'} as const;
type Options={model:FormalModelConfig;stage:FormalStage;toolVersion:string;exitCode:number|null;completed:boolean;diagnostics?:string[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nonemptyStrings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(x=>typeof x==='string'&&!!x);
const traceSeed=(raw:unknown)=>{try{return (typeof raw==='string'&&/^(?:\d+|0x[0-9a-f]+)$/i.test(raw)||typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0)?BigInt(raw as string|number).toString():undefined;}catch{return undefined;}};
/** Version-specific decoding of the CLI --out JSON. A child's exit0 alone
 * never establishes that a stage, test, invariant or backend check occurred. */
export function normalizeQuint(value:unknown,options:Options):FormalStageResult{
 const m=FormalModelConfigSchema.parse(options.model),s=options.stage,diagnostics=[...(options.diagnostics??[])];
 const checking=s==='run'||s==='verify';
 const row:FormalStageResult={stage:s,status:'unknown',complete:options.completed,exitCode:options.exitCode,toolVersion:options.toolVersion||'unavailable',backend:s==='verify'?'apalache':s==='run'||s==='test'?'typescript':'quint',method:methods[s],properties:checking?formalInvariants(m):[],...(checking?{maxSteps:m.maxSteps}:{}),...(s==='run'?{maxSamples:m.maxSamples,seed:m.seed}:{}),...(s==='verify'?{backendVersion:m.quint.apalacheVersion??APALACHE_VERSION}:{}),diagnostics};
 const done=(status:FormalStageResult['status'],reason?:string)=>{row.status=status;if(reason)diagnostics.push(reason);return FormalStageResultSchema.parse(row);};
 if(!options.completed||options.exitCode!==0&&options.exitCode!==1)return done('unknown','Tool did not complete with a recognized result');
 if(options.toolVersion!==QUINT_VERSION||m.quint.version!==QUINT_VERSION)return done('unknown','Unsupported or mismatched Quint version; verified compatibility is 0.33.1');
 if(!object(value)||value.stage!==stages[s])return done('unknown','Missing or incompatible Quint stage output');
 const errors=value.errors;
 if(errors!==undefined&&!Array.isArray(errors))return done('unknown','Malformed Quint error inventory');
 if(Array.isArray(errors))for(const error of errors.slice(0,20))if(object(error)){const message=typeof error.message==='string'?error.message:error.explanation;if(typeof message==='string')diagnostics.push(message.slice(0,2000));}
 if(s==='parse'||s==='typecheck'){
  if(options.exitCode===1&&Array.isArray(errors)&&errors.length)return done('fail');
  if(options.exitCode===0&&Array.isArray(value.modules)&&value.modules.length>0&&(!Array.isArray(errors)||!errors.length)&&(s==='parse'||object(value.types)&&object(value.effects))){
   const selection=formalSelection(m);
   if(s==='typecheck'){
    const discovered=discoverQuintDefinitions(value,selection);
    if(!discovered.selected){diagnostics.push(...discovered.diagnostics);return done('unknown');}
   }
   return done('pass');
  }
  return done('unknown','No completed syntax/type result');
 }
 if(s==='test'){
  if(!nonemptyStrings(value.passed)||!nonemptyStrings(value.failed)||!nonemptyStrings(value.ignored))return done('unknown','Malformed Quint test inventory');
  if(options.exitCode===1&&value.failed.length)return done('fail');
  if(options.exitCode===0&&value.passed.length&&!value.failed.length&&!value.ignored.length&&(!Array.isArray(errors)||!errors.length))return done('pass');
  return done('unknown','No complete nonempty spec-test inventory');
 }
 if(s==='run'){const seed=traceSeed(value.seed);if(seed===undefined)return done('unknown','Selected trace seed missing or unrepresentable');row.traceSeed=seed;}
 if(options.exitCode===1&&value.status==='violation'&&Array.isArray(value.trace)&&value.trace.length)return done('fail');
 if(options.exitCode===0&&value.status==='ok'&&(!Array.isArray(errors)||!errors.length)&&(s==='verify'||Array.isArray(value.trace)&&value.trace.length>0))return done('pass');
 return done('unknown','No explicit completed property-check result; failure/error is infrastructure, not a counterexample');
}
