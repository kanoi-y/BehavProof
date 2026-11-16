import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hash, type AssuranceDefinition, type AssuranceEvaluation, type Contract } from '@behavproof/core';
import * as registry from '../../packages/contract-registry/src/index.js';
import { defineContract } from '../../packages/contract-vitest/src/index.js';

const declaration = { id: 'LEGACY', intent: 'safe', risk: 'critical' as const, cases: [{ id: 'one', input: 1, expected: 2 }] };
const assurance: AssuranceDefinition = {
 feature: { id: 'refund', entrypoints: ['POST /refund'] },
 conditions: [{ id: 'authorized', kind: 'postcondition', statement: 'Only owners receive refunds', checks: ['owner'], requiredFaults: [{ id: 'bypass', kind: 'authorization', checkId: 'owner', implementation: 'fault.ts', detects: [{kind:'result',id:'denied'}] }] }],
 checks: [{ id: 'owner', method: 'example', targetRef: 'refund.ts#refund', cases: [{ id: 'denied', input: {owner:false}, expected: 'denied' }] }],
};
const source = (value: unknown) => `import {defineContract} from '@behavproof/vitest'; const c=defineContract(${JSON.stringify(value)});`;
const discover = (definition = assurance) => registry.discover({'contract.ts':source({...declaration,assurance:definition})});
const contract = (definition = assurance): Contract => ({...discover(definition).contracts[0]!,assurance:definition});
function evaluated(c: Contract): AssuranceEvaluation {
 const d=c.assurance!;
 return {status:'pass',reasons:[],checks:d.checks.map(scope=>({checkId:scope.id,method:scope.method,scope,status:'pass',reasons:[],comparisons:1,implementationCalls:1})),conditions:d.conditions.map(v=>({conditionId:v.id,kind:v.kind,statement:v.statement,checkIds:v.checks,status:'pass',reasons:[],faults:v.requiredFaults.map(f=>({faultId:f.id,checkId:f.checkId,status:'pass',reasons:[]}))}))};
}
const row = (c: Contract) => ({contractId:c.id,revisionHash:c.revisionHash,evaluation:evaluated(c),evidenceRefs:['reports/refund.json']});
const temp=mkdtempSync(join(tmpdir(),'behavproof-assurance-registry-'));
afterAll(()=>rmSync(temp,{recursive:true,force:true}));

describe('assurance metadata binding',()=>{
 it('discovers inline and manifest metadata without executing implementation or predicate code',()=>{
  const value={...declaration,assurance};
  const inline=registry.discover({'contract.ts':source(value)+`;throw Error('must not execute');`});
  const manifest=registry.discoverSources([{kind:'manifest',ref:'contract.json',content:JSON.stringify(value)}]);
  expect(inline.diagnostics).toEqual([]);expect(inline.contracts[0]?.assurance).toEqual(assurance);
  expect(manifest.contracts[0]?.assurance).toEqual(assurance);
  expect(manifest.contracts[0]?.revisionHash).toBe(inline.contracts[0]?.revisionHash);
  expect(inline.contracts[0]?.revisionHash).not.toBe(registry.discover({'contract.ts':source(declaration)}).contracts[0]?.revisionHash);
 });
 it('preserves exact legacy revision and generated document bytes',()=>{
  const d=registry.discover({'contract.ts':source(declaration)});
  expect(d.contracts[0]?.revisionHash).toBe('4cfeb69927d0e579f290e1a32806f040220086a111ac212d6596a345eac0bbfa');
  const docs=registry.renderDocuments(d);
  expect(Object.fromEntries(Object.entries(docs).map(([k,v])=>[k,hash(v)]))).toEqual({markdown:'1ce516880bbd155e7099cebfeadc1b0a3c3a09b3e9d211bf496b9a5d1b9da12e',html:'4d146b406cbdc8cea5deb6846f93554019cd7d50ffe1a6382c44ff15c278fde8',json:'44ec009ac5c4930b1e0d81f5e53926588d3f0a36fb6a93cf12fdc36b5e161bec'});
 });
 it('rejects invalid nested metadata at discovery and runtime',()=>{
  const invalid={...assurance,checks:[{...assurance.checks[0],method:'unknown'}]};
  expect(registry.discover({'x.ts':source({...declaration,assurance:invalid})}).diagnostics).toHaveLength(1);
  expect(registry.discoverSources([{kind:'manifest',ref:'x.json',content:JSON.stringify({...declaration,assurance:invalid})}]).diagnostics).toHaveLength(1);
  expect(()=>defineContract({...declaration,assurance:invalid} as any)).toThrow();
  expect(()=>defineContract({...declaration,kind:'invalid'} as any)).toThrow();
  expect(()=>defineContract({...declaration,formal:{modelId:'invalid'}} as any)).toThrow();
 });
 it('rejects duplicate condition/check/fault IDs and duplicate literal keys',()=>{
  for(const invalid of [{...assurance,conditions:[...assurance.conditions,...assurance.conditions]},{...assurance,checks:[...assurance.checks,...assurance.checks]},{...assurance,conditions:[{...assurance.conditions[0],requiredFaults:[...assurance.conditions[0]!.requiredFaults,...assurance.conditions[0]!.requiredFaults]}]}]) {
   expect(()=>defineContract({...declaration,assurance:invalid} as any)).toThrow(/duplicate/i);
   expect(()=>registry.discover({'x.ts':source({...declaration,assurance:invalid})})).toThrow(/duplicate/i);
  }
  const duplicate=source({...declaration,assurance}).replace('"feature":','"feature":{},"feature":');
  expect(()=>registry.discover({'x.ts':duplicate})).toThrow(/duplicate/i);
  expect(()=>registry.discoverSources([{kind:'manifest',ref:'x.json',content:JSON.stringify({...declaration,assurance}).replace('"feature":','"feature":{},"feature":')}])).toThrow(/duplicate/i);
 });
 it('does not execute computed assurance expressions during discovery',()=>{
  const dynamic=source({...declaration,assurance}).replace(JSON.stringify(assurance),'globalThis.mustNeverRun()');
  expect(registry.discover({'x.ts':dynamic})).toMatchObject({contracts:[],diagnostics:[{code:'CONTRACT_DISCOVERY_UNKNOWN'}]});
 });
 it('binds runtime registrations to identical inline/manifest revisions including kind/formal/assurance',()=>{
  const output=join(temp,'runtime.json');
  const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/assurance.config.ts','--reporter',resolve('packages/contract-vitest/dist/reporter.js')],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});
  expect(child.status,child.stderr+child.stdout).toBe(0);
  const report=JSON.parse(readFileSync(output,'utf8'));
  const found=registry.discover({'runtime.ts':readFileSync('tests/fixtures/contracts/assurance.fixture.ts','utf8')});
  expect(found.diagnostics).toEqual([]);expect(found.contracts).toHaveLength(4);
  for(const c of found.contracts) expect(report.registrations.find((r:any)=>r.contractId===c.id)?.revisionHash).toBe(c.revisionHash);
 });
});

describe('assurance semantic changes',()=>{
 it('shows removed conditions/checks/faults and retains the protected declaration',()=>{
  const base=discover(), next=registry.discover({'contract.ts':source(declaration)});
  const result=registry.reconcile(base,next);
  expect(result.obligations[0]?.revisionHash).toBe(base.contracts[0]?.revisionHash);
  for(const type of ['ASSURANCE_FEATURE_REMOVED','ASSURANCE_CONDITION_REMOVED','ASSURANCE_CHECK_REMOVED','ASSURANCE_FAULT_REMOVED']) expect(result.changes.map(c=>c.type)).toContain(type);
  expect(result.changes.find(c=>c.type==='ASSURANCE_CHECK_REMOVED')).toMatchObject({checkId:'owner',before:assurance.checks[0],after:null,transitionHash:registry.transitionHash(base.contracts[0]!,next.contracts[0])});
  expect(registry.reconcile(base,{contracts:[],intents:base.intents}).changes.map(c=>c.type)).toContain('ASSURANCE_CONDITION_REMOVED');
 });
 it('shows additions and changes with values without guessing logical strength',()=>{
  const next=structuredClone(assurance);next.feature.entrypoints.push('POST /admin-refund');next.conditions[0]!.statement='Revised statement';next.conditions[0]!.requiredFaults[0]!.kind='revised fault';next.checks[0]!.targetRef='new.ts#refund';
  const changes=registry.reconcile(discover(),discover(next)).changes;
  for(const type of ['ASSURANCE_FEATURE_CHANGED','ASSURANCE_CONDITION_CHANGED','ASSURANCE_CHECK_CHANGED','ASSURANCE_FAULT_CHANGED']) expect(changes.map(c=>c.type)).toContain(type);
  expect(changes.find(c=>c.type==='ASSURANCE_FEATURE_CHANGED')).toMatchObject({before:assurance.feature,after:next.feature});
  const additions=registry.reconcile(registry.discover({'contract.ts':source(declaration)}),discover()).changes;
  for(const type of ['ASSURANCE_FEATURE_ADDED','ASSURANCE_CONDITION_ADDED','ASSURANCE_CHECK_ADDED','ASSURANCE_FAULT_ADDED']) expect(additions.map(c=>c.type)).toContain(type);
 });
 it.each([
  {id:'scope',method:'property',targetRef:'target.ts#run',domain:{min:0,max:100},seed:'42',runs:100,minValid:50,maxDiscarded:50,requiredClasses:['owner'],generator:'gen.ts',predicate:'predicate.ts'},
  {id:'scope',method:'effects',targetRef:'target.ts#run',cases:[{id:'denied',input:0,expected:0}],scope:['db'],resources:[{scope:'db',adapter:'db.ts',targets:['db']}],allowedChanges:[],unchangedFields:[{scope:'db',field:'/balance'}],effects:[{id:'write',scope:'db',min:0,max:0}],window:{settledBy:'idle',durationMs:100}},
  {id:'scope',method:'journey',targetRef:'target.ts#run',entrypoint:'POST /refund',environment:{mode:'test'},mockBoundaries:[],layers:['http','db'],layerBindings:[{id:'http',adapter:'http.ts',targetRef:'http'},{id:'db',adapter:'db.ts',targetRef:'db'}],steps:[{id:'denied',action:'request',input:0,expected:0,layers:['http','db']}]},
 ] as const)('retains and exposes changed $method scope',check=>{
  const old:AssuranceDefinition={feature:assurance.feature,conditions:[{id:'scope',kind:'invariant',statement:'bounded',checks:['scope'],requiredFaults:[]}],checks:[structuredClone(check) as any]};
  const next=structuredClone(old);const c=next.checks[0]!;
  if(c.method==='property') {c.domain={min:0,max:1};c.runs=50;c.requiredClasses=[];}
  if(c.method==='effects') {c.window.durationMs=1;c.unchangedFields=[];}
  if(c.method==='journey') {c.layers=['http'];c.layerBindings=c.layerBindings.slice(0,1);c.steps[0]!.layers=['http'];c.environment={mode:'mock'};}
  const base=discover(old),head=discover(next),result=registry.reconcile(base,head);
  expect(result.obligations[0]?.revisionHash).toBe(base.contracts[0]?.revisionHash);
  expect(result.changes.find(c=>c.type==='ASSURANCE_CHECK_CHANGED')).toMatchObject({before:old.checks[0],after:next.checks[0]});
 });
});

describe('assurance review map',()=>{
 it('defaults fabricated evaluations to unknown and preserves declared scope and faults',()=>{
  const c=contract(),map=registry.buildAssuranceMap([c],[row(c)]);
  expect(map.contracts[0]).toMatchObject({key:JSON.stringify([c.id,c.revisionHash]),status:'unknown',conditions:[{status:'unknown',faults:[{status:'unknown'}]}],checks:[{status:'unknown',scope:assurance.checks[0]}],evidenceRefs:[]});
  expect(registry.renderAssuranceMap(map).markdown).toContain('unknown');
  expect(registry.buildAssuranceMap([c],[row(c)],(()=>Promise.resolve(true)) as any).contracts[0]?.status).toBe('unknown');
 });
 it('selects evaluated evidence by revision and rejects duplicates, stale rows and scope mismatches',()=>{
  const old=contract(),definition=structuredClone(assurance);definition.checks[0]!.targetRef='new.ts#refund';const head=contract(definition),accepted=row(head);
  const map=registry.buildAssuranceMap([head,old],[accepted],r=>r===accepted);
  expect(map.contracts.find(c=>c.revisionHash===head.revisionHash)?.status).toBe('pass');
  expect(map.contracts.find(c=>c.revisionHash===old.revisionHash)?.status).toBe('unknown');
  expect(new Set(map.contracts.map(c=>c.key)).size).toBe(2);
  expect(registry.buildAssuranceMap([head],[accepted,accepted],()=>true).contracts[0]?.status).toBe('unknown');
  expect(registry.buildAssuranceMap([old],[accepted],()=>true).contracts[0]?.status).toBe('unknown');
  const wrong=row(old);wrong.evaluation.checks[0]!.scope=head.assurance!.checks[0]!;
  expect(registry.buildAssuranceMap([old],[wrong],()=>true).contracts[0]?.status).toBe('unknown');
  expect(registry.buildAssuranceMap([old],[{...row(old),evaluation:{status:'pass'}} as any],()=>true).contracts[0]?.status).toBe('unknown');
 });
 it('renders independent condition/fault/check outcomes and evidence with scope limits',()=>{
  const c=contract(),accepted=row(c);accepted.evaluation.status='unknown';accepted.evaluation.conditions[0]!.status='unknown';accepted.evaluation.conditions[0]!.faults[0]!.status='unknown';accepted.evaluation.conditions[0]!.faults[0]!.reasons=['Fault has no observed behavioral mismatch'];
  const map=registry.buildAssuranceMap([c],[accepted],()=>true),docs=registry.renderAssuranceMap(map);
  expect(map.contracts[0]?.checks[0]?.status).toBe('pass');expect(map.contracts[0]?.conditions[0]?.status).toBe('unknown');
  for(const rendered of [docs.markdown,docs.html,docs.json]) for(const value of ['refund','authorized','owner','bypass','reports/refund','Fault has no observed behavioral mismatch','refund','limits']) expect(rendered).toContain(value);
 });
 it('matches legacy execution and approval evidence to either revision in generated documents and graph',()=>{
  const old=contract(),definition=structuredClone(assurance);definition.checks[0]!.targetRef='new.ts#refund';const head=contract(definition);
  const execution={id:'execution',testId:'test',contractId:head.id,caseId:'one',revisionHash:head.revisionHash,bindingHash:'b'.repeat(64),comparisonCount:1,status:'pass' as const};
  const bindings={[registry.bindingKey(head.id,'one','test')]:execution.bindingHash};
  const approval={schemaVersion:1,id:'approval',target:{kind:'contract' as const,id:head.id,contentHash:head.revisionHash},status:'pass' as const,source:{provider:'fixture',ref:'review'},approvedBy:['reviewer'],reasons:[]};
  const data={contracts:[old,head],intents:[]};
  const docs=JSON.parse(registry.renderDocuments(data,[execution],{expectedBindings:bindings,verifyEvidence:()=>true,approvals:[approval],verifyApproval:()=>true}).json);
  expect(docs.execution[0].effectiveStatus).toBe('pass');expect(docs.approvals[0].effectiveStatus).toBe('pass');
  const graph=registry.buildEvidenceGraph({registry:data,executions:[execution],rules:[],approvals:[approval],expectedBindings:bindings},()=>true,()=>true);
  expect(graph.edges.find(e=>e.kind==='case_executed_by_test')?.status).toBe('pass');expect(graph.edges.find(e=>e.kind==='approved_by')?.status).toBe('pass');
 });
 it.each([
  ['preserve $& verbatim', 'preserve $&amp; verbatim'],
  ['preserve $` verbatim', 'preserve $` verbatim'],
  ["preserve $' verbatim", 'preserve $&#39; verbatim'],
  ['preserve $$ verbatim', 'preserve $$ verbatim'],
 ])('preserves literal replacement metacharacters when embedding assurance HTML: %s',(statement,escaped)=>{
  const d=structuredClone(assurance);d.conditions[0]!.statement=statement;
  const c=contract(d);
  const html=registry.renderDocuments({contracts:[c],intents:[]}).html;
  expect(html).toContain(`; ${escaped}; checks:`);
  expect(html.match(/<\/body><\/html>/g)).toHaveLength(1);
  expect(html.match(/<!doctype html>/g)).toHaveLength(1);
 });
 it('escapes hostile declarations/reasons/refs in Markdown and HTML and appends only for adopters',()=>{
  const hostile='<script>alert(1)</script> [click](javascript:alert(1))\n# injected | cell';
  const d=structuredClone(assurance);d.feature.id=hostile;d.conditions[0]!.statement=hostile;d.checks[0]!.targetRef=hostile;
  const c=contract(d),accepted=row(c);accepted.evaluation.reasons=[hostile];accepted.evidenceRefs=[hostile];
  const docs=registry.renderDocuments({contracts:[c],intents:[]},[],{assuranceResults:[accepted],verifyAssurance:()=>true});
  for(const rendered of [docs.markdown,docs.html]) expect(rendered).not.toContain('<script>');
  expect(docs.markdown).not.toContain('[click](javascript:');expect(docs.markdown).not.toContain('\n# injected');
  expect(JSON.parse(docs.json).assurance.contracts[0]).toMatchObject({status:'pass',feature:d.feature});
  expect(registry.renderDocuments({contracts:[c],intents:[]}).markdown).toContain('unknown');
  expect(JSON.parse(registry.renderDocuments({contracts:[],intents:[]}).json)).not.toHaveProperty('assurance');
 });
});
