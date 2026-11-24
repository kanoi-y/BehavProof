import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {hash,hashBytes,evaluateAssuranceConditions,type AssuranceTarget} from '../../packages/core/src/index.js';
import {inspectArchitecture} from '../../packages/spec-registry/src/architecture.js';
import {runAssurance,type RuntimeDriver} from '../../packages/spec-registry/src/assurance-runtime.js';
let root:string,inputs:Record<string,string>;
const subject={testedCommitSha:'a'.repeat(40),sourceTreeHash:'b'.repeat(64)};
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'assurance-runtime-'));inputs={};await mkdir(join(root,'src'));
 await put('src/target.mjs',`export async function run(input,env){if(input.action){if(input.action==='add')env.dependencies.n+=input.parameters;return env.dependencies.n;}return input*2;} export function observe(deps){return deps.n;}`);
 await put('src/fault.mjs',`export async function run(input,env){if(input.action){env.dependencies.n+=input.parameters*2;return env.dependencies.n;}return input*3;} export function observe(deps){return deps.n;}`);
 await put('generator.mjs',`export function generate({index}){return index;} export function classify(input){return input===0?['zero']:['positive'];} export function generateTrace(){return {initial:0,actions:[{action:'add',input:1},{action:'add',input:2}]};}`);
 await put('predicate.mjs',`export function test(input,actual){return actual===input*2;}`);
 await put('model.mjs',`export function initial(x){return x;} export function next(state,action){return state+action.input;}`);
 await put('projection.mjs',`export function project(value){return value;}`);
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function put(path:string,source:string){await writeFile(join(root,path),source);inputs[path]=hashBytes(Buffer.from(source));}
function contract(check:any,fault?:any):AssuranceTarget{return {id:'C',sourceRef:'behavproof.config.json',revisionHash:hash(check),assurance:{feature:{id:'refund',entrypoints:['POST /refund']},checks:[check],conditions:[{id:'safe',kind:check.method==='example'?'postcondition':check.method==='sequence'?'invariant':check.method==='effects'?'effect':check.method,statement:'safe behavior',checks:[check.id],requiredFaults:fault?[fault]:[]}]}};}
async function run(c:Contract,driver:RuntimeDriver={}){
 const bundle=await runAssurance({root,targets:[c],subject,inputHashes:inputs,implementationSources:['src/target.mjs'],driver});
 const report=bundle.reports[0]!;
 return {bundle,report,evaluation:evaluateAssuranceConditions(c.assurance!,[report],{definitionId:c.id,revisionHash:c.revisionHash,subject,inputHashes:inputs,implementationSources:['src/target.mjs'],checkHashes:Object.fromEntries(c.assurance!.checks.map(x=>[x.id,hash(x)])),authenticatedReportHashes:[hash(report)]})};
}
const example=()=>({id:'double',method:'example',targetRef:'src/target.mjs#run',cases:[{id:'zero',input:0,expected:0},{id:'two',input:2,expected:4}]});
it('invokes selected exports and replays exact normal comparisons against a real faulty module',async()=>{
 const c=contract(example(),{id:'wrong-result',kind:'result',checkId:'double',implementation:'src/fault.mjs',detects:[{kind:'result',id:'two'}]});
 const {evaluation,report}=await run(c);
 expect(evaluation.status).toBe('pass');expect(report.checks[0]).toMatchObject({comparisonCount:2});
 expect(report.faults[0]?.observation).toMatchObject({comparisonCount:2});
 expect((report.checks[0] as any).samples[1].receipts[0]).toMatchObject({implementation:'src/target.mjs',input:2,output:4});
});
it('cannot replace the actual invocation with a driver-authored callback or count',async()=>{
 const c=contract({...example(),cases:[{id:'two',input:2,expected:999}]});
 const {evaluation}=await run(c,{createContext:()=>({dependencies:{},execute:()=>999,calls:1})} as any);
 expect(evaluation.status).toBe('fail');
});
it('captures source errors without mistaking a fault crash for behavioral sensitivity',async()=>{
 await put('src/fault.mjs',`export function run(){throw Error('offline');}`);
 const {evaluation}=await run(contract(example(),{id:'crash',kind:'result',checkId:'double',implementation:'src/fault.mjs',detects:[{kind:'result',id:'two'}]}));
 expect(evaluation.status).toBe('unknown');expect(evaluation.conditions[0]?.faults[0]?.status).toBe('unknown');
});
it('collects valid/discarded property trials and materialized failing inputs',async()=>{
 const check={id:'p',method:'property',targetRef:'src/target.mjs#run',domain:{min:0,max:3},seed:'42',runs:4,minValid:4,maxDiscarded:0,requiredClasses:['zero','positive'],generator:'generator.mjs',predicate:'predicate.mjs'};
 const {evaluation,report}=await run(contract(check,{id:'triple',kind:'result',checkId:'p',implementation:'src/fault.mjs',detects:[{kind:'result',id:'trial-1'}]}));
 expect(evaluation.status).toBe('pass');expect(report.checks[0]).toMatchObject({valid:4,discarded:0,runs:4});
 expect((report.faults[0]?.observation as any).counterexamples[0]).toMatchObject({originalInput:1,seed:'42'});
 await put('generator.mjs',`export function generate({index}){return index;}export function accept(){return false;}`);
 await expect(run(contract(check))).rejects.toThrow(/fresh Node process/);
});
it('replays independent model state and exact generated action sequences',async()=>{
 const check={id:'s',method:'sequence',targetRef:'src/target.mjs#run',seed:'42',generator:'generator.mjs',model:'model.mjs',projection:'projection.mjs',maxSteps:2,minTraces:2,requiredActions:['add']};
 const {evaluation,report}=await run(contract(check,{id:'double-add',kind:'transition',checkId:'s',implementation:'src/fault.mjs',detects:[{kind:'result',id:'trace-0:step-0'}]}),{createContext:()=>({dependencies:{n:0}})});
 expect(evaluation.status).toBe('pass');expect(report.checks[0]).toMatchObject({comparisonCount:4});
 expect((report.checks[0] as any).traces[0].steps.map((x:any)=>[x.modelBefore,x.expected,x.actual])).toEqual([[0,1,1],[1,3,3]]);
});
it('records writes even if a denied operation restores the original state',async()=>{
 await put('store.mjs',`export function snapshot(targets,deps){return {balance:deps.balance};}export function perform(event,deps){deps.balance+=event.input;return deps.balance;}`);
 await put('src/target.mjs',`export function run(){return 'denied';}`);
 await put('src/fault.mjs',`export async function run(input,env){await env.effect('orders','write','order-1','update',-1);await env.effect('orders','write','order-1','update',1);return 'denied';}`);
 const check={id:'e',method:'effects',targetRef:'src/target.mjs#run',cases:[{id:'denied',input:null,expected:'denied'}],scope:['orders'],resources:[{scope:'orders',adapter:'store.mjs',targets:['order-1']}],allowedChanges:[],unchangedFields:[{scope:'orders',field:'/balance'}],effects:[{id:'write',scope:'orders',min:0,max:0}],window:{durationMs:1,settledBy:'bounded window'}};
 const {evaluation,report}=await run(contract(check,{id:'write-undo',kind:'forbidden-write',checkId:'e',implementation:'src/fault.mjs',detects:[{kind:'effect',id:'denied',scope:'orders',effectId:'write'}]}),{createContext:()=>({dependencies:{balance:10}})});
 expect(evaluation.status).toBe('pass');const faulty=report.faults[0]?.observation as any;
 expect(faulty.samples[0].before).toEqual(faulty.samples[0].after);expect(faulty.samples[0].effects).toHaveLength(2);
});
it('parses real source imports, detects a substituted forbidden import and leaves dynamic constructs unknown',async()=>{
 await put('src/ui.mjs',`export {run} from './target.mjs';`);await put('src/architecture-fault.mjs',`import db from 'forbidden-db/client';export {db};`);
 const check={id:'a',method:'architecture',targetRef:'src/ui.mjs',files:['src/ui.mjs','src/target.mjs'],rules:[{id:'ui-boundary',from:['src/ui.mjs'],forbidden:['forbidden-db']}]};
 expect((await run(contract(check,{id:'db-import',kind:'dependency',checkId:'a',implementation:'src/architecture-fault.mjs',detects:[{kind:'rule',id:'ui-boundary'}]}))).evaluation.status).toBe('pass');
 await put('src/ui.mjs',`const load=()=>import('./target.mjs');`);
 expect((await run(contract(check))).evaluation.status).toBe('unknown');
});
it('uses real correlated HTTP/store boundaries for an ordered journey',async()=>{
 await put('http.mjs',`export async function request(input,deps){const r=await fetch(deps.url,{headers:{'x-call':deps.callId()}});return r.json();}`);
 await put('store.mjs',`export function read(input,deps){deps.reads++;return {balance:deps.balance};}`);
 await put('src/target.mjs',`export function run(input,env){return env.layer('http',input);}`);
 const check={id:'j',method:'journey',targetRef:'src/target.mjs#run',entrypoint:'POST /refund',environment:{kind:'local-http'},mockBoundaries:[],layers:['http','database'],layerBindings:[{id:'http',adapter:'http.mjs',targetRef:'http.mjs#request'},{id:'database',adapter:'store.mjs',targetRef:'store.mjs#read'}],steps:[{id:'read',action:'read',input:null,expected:{balance:10},layers:['http','database']}]};
 const {evaluation,report}=await run(contract(check),{async createContext({harness}){
  const deps:any={balance:10,reads:0,callId:()=>harness.invocationId()};
  const server=createServer((req,res)=>{harness.withInvocation(String(req.headers['x-call']),async()=>{const value=await harness.layer('database',null);res.setHeader('content-type','application/json');res.end(JSON.stringify(value));}).catch(e=>{res.statusCode=500;res.end(JSON.stringify(String(e)));});});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));deps.url=`http://127.0.0.1:${(server.address() as any).port}`;
  return {dependencies:deps,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
 }});
 expect(evaluation.status).toBe('pass');expect((report.checks[0] as any).steps[0].layers.map((l:any)=>l.id).sort()).toEqual(['database','http']);
});
it('refuses sources changed before module loading',async()=>{
 inputs['src/target.mjs']='f'.repeat(64);
 await expect(run(contract(example()))).rejects.toThrow(/source.*identity|input.*changed/i);
});
it('captures delayed operations inside the declared window',async()=>{
 await put('store.mjs',`export function snapshot(t,d){return {n:d.n};}export function perform(e,d){d.n++;return d.n;}`);
 await put('src/target.mjs',`export function run(i,env){setTimeout(()=>env.effect('s','write','record','update',null),2);return 'denied';}`);
 const c=contract({id:'late',method:'effects',targetRef:'src/target.mjs#run',cases:[{id:'denied',input:null,expected:'denied'}],scope:['s'],resources:[{scope:'s',adapter:'store.mjs',targets:['record']}],allowedChanges:[],unchangedFields:[{scope:'s',field:'/n'}],effects:[{id:'write',scope:'s',min:0,max:0}],window:{durationMs:20,settledBy:'bounded window'}});
 const {evaluation,report}=await run(c,{createContext:()=>({dependencies:{n:0}})});expect(evaluation.status).toBe('fail');expect((report.checks[0] as any).samples[0].effects).toHaveLength(1);
});
it('does not accept a canned journey output without actual required layer invocations',async()=>{
 await put('src/target.mjs',`export function run(){return 2;}`);await put('layer.mjs',`export function read(){return 2;}`);
 const c=contract({id:'fake',method:'journey',targetRef:'src/target.mjs#run',entrypoint:'POST /refund',environment:{kind:'fixture'},mockBoundaries:[],layers:['database'],layerBindings:[{id:'database',adapter:'layer.mjs',targetRef:'layer.mjs#read'}],steps:[{id:'read',action:'read',input:1,expected:2,layers:['database']}]});
 expect((await run(c,{createContext:()=>({layers:['database'],calls:100})} as any)).evaluation.status).toBe('unknown');
});
it('clones normal inputs and expectations before targets can mutate them',async()=>{
 await put('src/target.mjs',`export function run(input){input.n=99;return {n:2};}`);
 const check={id:'immutable',method:'example',targetRef:'src/target.mjs#run',cases:[{id:'one',input:{n:1},expected:{n:2}}]},c=contract(check),before=JSON.stringify(c);
 const {evaluation,report}=await run(c);expect(evaluation.status).toBe('pass');expect(JSON.stringify(c)).toBe(before);expect((report.checks[0] as any).samples[0].input).toEqual({n:1});
});
it('refuses persistent source mutations made by an executing target',async()=>{
 await put('src/target.mjs',`import{writeFileSync}from'node:fs';export function run(i,env){writeFileSync(env.dependencies.file,'changed');return i*2;}`);
 await expect(run(contract(example()),{createContext:()=>({dependencies:{file:join(root,'generator.mjs')}})})).rejects.toThrow(/identity changed during/);
});
it('keeps zero-action sequence and parser/alias failures unknown',async()=>{
 await put('generator.mjs',`export function generateTrace(){return {initial:0,actions:[]};}`);
 const c=contract({id:'zero',method:'sequence',targetRef:'src/target.mjs#run',seed:'42',generator:'generator.mjs',model:'model.mjs',projection:'projection.mjs',maxSteps:2,minTraces:1,requiredActions:['add']});
 expect((await run(c,{createContext:()=>({dependencies:{n:0}})})).evaluation.status).toBe('unknown');
 await put('src/ui.mjs',`import thing from '@/database';`);const a=contract({id:'parse',method:'architecture',targetRef:'src/ui.mjs',files:['src/ui.mjs'],rules:[{id:'no-db',from:['src/ui.mjs'],forbidden:['database']}]});
 expect((await run(a)).evaluation.status).toBe('unknown');await put('src/ui.mjs','import { broken');expect((await run(a)).evaluation.status).toBe('unknown');
});
it('links shrink results only to actual failing inputs observed in the same seeded batch',async()=>{
 await put('shrinker.mjs','export function shrink(){return [0,1];}');
 const c=contract({id:'p',method:'property',targetRef:'src/target.mjs#run',domain:{min:0,max:3},seed:'42',runs:4,minValid:4,maxDiscarded:0,requiredClasses:[],generator:'generator.mjs',predicate:'predicate.mjs',shrinker:'shrinker.mjs'},{id:'triple',kind:'result',checkId:'p',implementation:'src/fault.mjs',detects:[{kind:'result',id:'trial-1'}]});
 const {evaluation,report}=await run(c);expect(evaluation.status).toBe('pass');
 expect((report.faults[0]?.observation as any).counterexamples.find((c:any)=>c.sampleId==='trial-2')).toMatchObject({originalInput:2,shrunkInput:1,shrunkSampleId:'trial-1'});
});

it.each([
 ['named createRequire',"import {createRequire} from 'node:module';const load=createRequire(import.meta.url);export const fs=load('node:fs');"],
 ['aliased createRequire',"import {createRequire as makeLoader} from 'node:module';const load=makeLoader(import.meta.url);export const fs=load('node:fs');"],
 ['bare module createRequire',"import {createRequire} from 'module';const load=createRequire(import.meta.url);export const fs=load('fs');"],
 ['require alias',"const load=require;const fs=load('node:fs');"],
 ['parenthesized require alias',"const load=(require);const fs=load('node:fs');"],
 ['assigned require alias',"let load;load=require;const fs=load('node:fs');"],
 ['parenthesized assigned require alias',"let load;load=((require));const fs=load('node:fs');"],
 ['namespace createRequire',"import * as module from 'node:module';const load=module.createRequire(import.meta.url);load('node:fs');"],
 ['default createRequire',"import module from 'node:module';const load=module.createRequire(import.meta.url);load('node:fs');"],
 ['computed createRequire',"import * as module from 'node:module';const load=module['createRequire'](import.meta.url);load('node:fs');"],
 ['require-module createRequire',"const module=require('node:module');const load=module.createRequire(__filename);load('node:fs');"],
 ['destructured createRequire',"const {createRequire:makeLoader}=require('node:module');const load=makeLoader(__filename);load('node:fs');"],
 ['direct property createRequire',"const load=require('node:module').createRequire(__filename);load('node:fs');"],
 ['aliased factory',"import {createRequire} from 'node:module';const makeLoader=createRequire;const load=makeLoader(import.meta.url);load('node:fs');"],

])('keeps the known indirect %s loader unknown',async(_name,source)=>{
 await put('src/ui.mjs',source);
 const check={id:'loader',method:'architecture' as const,targetRef:'src/ui.mjs',files:['src/ui.mjs'],rules:[{id:'no-filesystem',from:['src/ui.mjs'],forbidden:['node:fs']}]};
 const {evaluation,report}=await run(contract(check));
 expect((report.checks[0] as any).unsupported).toContainEqual({file:'src/ui.mjs',reason:expect.stringMatching(/indirect.*loader/i)});
 expect(evaluation.checks[0]?.status).toBe('unknown');expect(evaluation.conditions[0]?.status).toBe('unknown');
});
it.each([
 ["import fs from 'fs';",'node:fs','fs'],
 ["import fs from 'node:fs';",'fs','node:fs'],
 ["export {readFile} from 'fs/promises';",'node:fs','fs/promises'],
 ["import {readFile} from 'node:fs/promises';",'fs','node:fs/promises'],
 ["const fs=require('fs');",'node:fs','fs'],
 ["const fs=require('node:fs/promises');",'fs','node:fs/promises'],
])('rejects the builtin spelling in %s against %s',async(source,forbidden,specifier)=>{
 await put('src/ui.mjs',source);
 const check={id:'builtin',method:'architecture' as const,targetRef:'src/ui.mjs',files:['src/ui.mjs'],rules:[{id:'no-filesystem',from:['src/ui.mjs'],forbidden:[forbidden]}]};
 const {evaluation,report}=await run(contract(check)),observation=report.checks[0] as any;
 expect(observation.files[0].imports[0]).toMatchObject({specifier,supported:true});
 expect(observation.violations).toEqual([{ruleId:'no-filesystem',file:'src/ui.mjs',specifier}]);
 expect(evaluation.status).toBe('fail');
});
it.each([
 ["import fsExtra from 'fs-extra';",'node:fs'],
 ["import thing from 'fs/consumer-package';",'node:fs'],
 ["import test from 'node:test';",'test'],
])('does not rewrite non-alias dependencies in %s',async(source,forbidden)=>{
 await put('src/ui.mjs',source);
 const check={id:'external',method:'architecture' as const,targetRef:'src/ui.mjs',files:['src/ui.mjs'],rules:[{id:'no-filesystem',from:['src/ui.mjs'],forbidden:[forbidden]}]};
 const {evaluation,report}=await run(contract(check)),observation=report.checks[0] as any;
 expect(evaluation.status).toBe('pass');expect(observation.files[0].imports[0].resolved).toBeUndefined();
});
it('preserves direct static import, export, and require dependency observations',async()=>{
 await put('src/ui.mjs',"import path from 'node:path';export {run} from './target.mjs';const url=require('node:url');");
 const check={id:'static',method:'architecture' as const,targetRef:'src/ui.mjs',files:['src/ui.mjs'],rules:[{id:'no-filesystem',from:['src/ui.mjs'],forbidden:['node:fs']}]};
 const {evaluation,report}=await run(contract(check));
 expect(evaluation.status).toBe('pass');expect((report.checks[0] as any).files[0].imports.map((i:any)=>i.specifier)).toEqual(['node:path','./target.mjs','node:url']);
});
it('preserves the shipped UI boundary normal result and detects its no-filesystem fault with either spelling',async()=>{
 const exampleRoot=join(process.cwd(),'examples/assurance-refund'),config=JSON.parse(await readFile(join(exampleRoot,'behavproof.config.json'),'utf8'));
 const declaration=config.assurance.definitions[0].definition;
 const check=declaration.checks.find((c:any)=>c.id==='ui-boundary'),condition=declaration.conditions.find((c:any)=>c.id==='ui-boundary');
 const sourceBytes=Object.fromEntries(await Promise.all(check.files.map(async(p:string)=>[p,await readFile(join(exampleRoot,p))])));
 const normal=inspectArchitecture(check,sourceBytes);
 expect(normal.unsupported).toEqual([]);expect(normal.violations).toEqual([]);
 const fault=await readFile(join(exampleRoot,condition.requiredFaults[0].implementation),'utf8');
 for(const source of [fault,fault.replace('node:fs','fs')]){
  const observation=inspectArchitecture(check,sourceBytes,{source:Buffer.from(source)});
  expect(observation.unsupported).toEqual([]);
  expect(observation.violations).toEqual([{ruleId:'no-ui-storage',file:'src/ui.mjs',specifier:source.includes('node:fs')?'node:fs':'fs'}]);
 }
});
