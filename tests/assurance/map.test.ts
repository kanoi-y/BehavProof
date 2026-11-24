import { describe, expect, it } from 'vitest';
import { hash, type AssuranceDefinition, type AssuranceEvaluation, type AssuranceTarget } from '@behavproof/core';
import {renderSpecificationDocuments} from '../../packages/cli/src/specification-documents.js';
import * as registry from '../../packages/spec-registry/src/index.js';

const assurance: AssuranceDefinition = {
 feature: { id: 'refund', entrypoints: ['POST /refund'] },
 conditions: [{ id: 'authorized', kind: 'postcondition', statement: 'Only owners receive refunds', checks: ['owner'], requiredFaults: [{ id: 'bypass', kind: 'authorization', checkId: 'owner', implementation: 'fault.ts', detects: [{kind:'result',id:'denied'}] }] }],
 checks: [{ id: 'owner', method: 'example', targetRef: 'refund.ts#refund', cases: [{ id: 'denied', input: {owner:false}, expected: 'denied' }] }],
};
const definitionTarget = (definition = assurance): AssuranceTarget => ({
 id:'refund',sourceRef:'behavproof.config.json',assurance:definition,revisionHash:hash(definition),
});
function evaluated(c: AssuranceTarget): AssuranceEvaluation {
 const d=c.assurance!;
 return {status:'pass',reasons:[],checks:d.checks.map(scope=>({checkId:scope.id,method:scope.method,scope,status:'pass',reasons:[],comparisons:1,implementationCalls:1})),conditions:d.conditions.map(v=>({conditionId:v.id,kind:v.kind,statement:v.statement,checkIds:v.checks,status:'pass',reasons:[],faults:v.requiredFaults.map(f=>({faultId:f.id,checkId:f.checkId,status:'pass',reasons:[]}))}))};
}
const row = (c: AssuranceTarget) => ({definitionId:c.id,revisionHash:c.revisionHash,evaluation:evaluated(c),evidenceRefs:['reports/refund.json']});

describe('assurance review map',()=>{
 it('defaults fabricated evaluations to unknown and preserves declared scope and faults',()=>{
  const c=definitionTarget(),map=registry.buildAssuranceMap([c],[row(c)]);
  expect(map.definitions[0]).toMatchObject({key:JSON.stringify([c.id,c.revisionHash]),status:'unknown',conditions:[{status:'unknown',faults:[{status:'unknown'}]}],checks:[{status:'unknown',scope:assurance.checks[0]}],evidenceRefs:[]});
  expect(registry.renderAssuranceMap(map).markdown).toContain('unknown');
  expect(registry.buildAssuranceMap([c],[row(c)],(()=>Promise.resolve(true)) as any).definitions[0]?.status).toBe('unknown');
 });
 it('selects evaluated evidence by revision and rejects duplicates, stale rows and scope mismatches',()=>{
  const old=definitionTarget(),definition=structuredClone(assurance);definition.checks[0]!.targetRef='new.ts#refund';const head=definitionTarget(definition),accepted=row(head);
  const map=registry.buildAssuranceMap([head,old],[accepted],r=>r===accepted);
  expect(map.definitions.find(c=>c.revisionHash===head.revisionHash)?.status).toBe('pass');
  expect(map.definitions.find(c=>c.revisionHash===old.revisionHash)?.status).toBe('unknown');
  expect(new Set(map.definitions.map(c=>c.key)).size).toBe(2);
  expect(registry.buildAssuranceMap([head],[accepted,accepted],()=>true).definitions[0]?.status).toBe('unknown');
  expect(registry.buildAssuranceMap([old],[accepted],()=>true).definitions[0]?.status).toBe('unknown');
  const wrong=row(old);wrong.evaluation.checks[0]!.scope=head.assurance!.checks[0]!;
  expect(registry.buildAssuranceMap([old],[wrong],()=>true).definitions[0]?.status).toBe('unknown');
  expect(registry.buildAssuranceMap([old],[{...row(old),evaluation:{status:'pass'}} as any],()=>true).definitions[0]?.status).toBe('unknown');
 });
 it('renders independent condition/fault/check outcomes and evidence with scope limits',()=>{
  const c=definitionTarget(),accepted=row(c);accepted.evaluation.status='unknown';accepted.evaluation.conditions[0]!.status='unknown';accepted.evaluation.conditions[0]!.faults[0]!.status='unknown';accepted.evaluation.conditions[0]!.faults[0]!.reasons=['Fault has no observed behavioral mismatch'];
  const map=registry.buildAssuranceMap([c],[accepted],()=>true),docs=registry.renderAssuranceMap(map);
  expect(map.definitions[0]?.checks[0]?.status).toBe('pass');expect(map.definitions[0]?.conditions[0]?.status).toBe('unknown');
  for(const rendered of [docs.markdown,docs.html,docs.json]) for(const value of ['refund','authorized','owner','bypass','reports/refund','Fault has no observed behavioral mismatch','refund','limits']) expect(rendered).toContain(value);
 });
 it.each([
  ['preserve $& verbatim', 'preserve $&amp; verbatim'],
  ['preserve $` verbatim', 'preserve $` verbatim'],
  ["preserve $' verbatim", 'preserve $&#39; verbatim'],
  ['preserve $$ verbatim', 'preserve $$ verbatim'],
 ])('preserves literal replacement metacharacters when embedding assurance HTML: %s',(statement,escaped)=>{
  const d=structuredClone(assurance);d.conditions[0]!.statement=statement;
  const c=definitionTarget(d);
  const html=renderSpecificationDocuments([],[],registry.buildAssuranceMap([c],[])).html;
  expect(html).toContain(`; ${escaped}; checks:`);
  expect(html.match(/<\/body><\/html>/g)).toHaveLength(1);
  expect(html.match(/<!doctype html>/g)).toHaveLength(1);
 });
 it('escapes hostile declarations/reasons/refs in Markdown and HTML and appends only for adopters',()=>{
  const hostile='<script>alert(1)</script> [click](javascript:alert(1))\n# injected | cell';
  const d=structuredClone(assurance);d.feature.id=hostile;d.conditions[0]!.statement=hostile;d.checks[0]!.targetRef=hostile;
  const c=definitionTarget(d),accepted=row(c);accepted.evaluation.reasons=[hostile];accepted.evidenceRefs=[hostile];
  const docs=renderSpecificationDocuments([],[],registry.buildAssuranceMap([c],[accepted],()=>true));
  for(const rendered of [docs.markdown,docs.html]) expect(rendered).not.toContain('<script>');
  expect(docs.markdown).not.toContain('[click](javascript:');expect(docs.markdown).not.toContain('\n# injected');
  expect(JSON.parse(docs.json).assurance.definitions[0]).toMatchObject({status:'pass',feature:d.feature});
  expect(renderSpecificationDocuments([],[],registry.buildAssuranceMap([c],[])).markdown).toContain('unknown');
  expect(JSON.parse(renderSpecificationDocuments([],[]).json)).not.toHaveProperty('assurance');
 });
});
