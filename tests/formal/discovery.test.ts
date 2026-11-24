import {expect, it} from 'vitest';
import {discoverQuintDefinitions,quintInvariantFingerprint} from '../../packages/adapter-quint/src/index.js';

function output() {
  return {
    stage: 'typechecking',
    modules: [
      {name: 'lookup', declarations: [{id: 10, name: 'safe', kind: 'def', qualifier: 'val'}]},
      {name: 'orders', declarations: [
        {id: 1, name: 'init', kind: 'def', qualifier: 'action'},
        {id: 2, name: 'step', kind: 'def', qualifier: 'action'},
        {id: 3, name: 'safe', kind: 'def', qualifier: 'val'},
        {id: 4, name: 'refunded', kind: 'def', qualifier: 'val'},
        {id: 5, name: 'refund', kind: 'def', qualifier: 'action'},
        {id: 6, name: 'helper', kind: 'def', qualifier: 'val'},
      ]},
    ],
    types: Object.fromEntries([1,2,3,4,5,6,10].map(id => [id, {type: {kind: id === 10 ? 'int' : 'bool'}}])),
    effects: Object.fromEntries([1,2,3,4,5,6,10].map(id => [id, {effect: {
      kind: 'concrete', components: [{kind: [1,2,5].includes(id) ? 'update' : 'read'}],
    }}])),
  };
}

const selection = {module: 'orders', init: 'init', step: 'step',
  invariants: ['safe'], witnesses: ['refunded'], requiredActions: ['refund']};

it('selects roles explicitly in the named module, retaining separately discovered definitions', () => {
  const result = discoverQuintDefinitions(output(), selection);
  expect(result.diagnostics).toEqual([]);
  expect(result.selected).toEqual(selection);
  expect(result.modules.find(module => module.name === 'orders')?.definitions)
    .toContainEqual({name: 'helper', kind: 'def', qualifier: 'val'});
  expect(result.selected?.invariants).not.toContain('helper');
});

it.each([
  {selection: {...selection, module: 'absent'}, diagnostic: 'module'},
  {selection: {...selection, witnesses: ['absent']}, diagnostic: 'absent'},
  {selection: {...selection, invariants: ['refund']}, diagnostic: 'refund'},
  {selection: {...selection, requiredActions: ['refunded']}, diagnostic: 'refunded'},
])('withholds selection if $diagnostic is missing or in the wrong role', ({selection, diagnostic}) => {
  const result = discoverQuintDefinitions(output(), selection);
  expect(result.selected).toBeUndefined();
  expect(result.diagnostics.join(' ')).toContain(diagnostic);
});

it('rejects ambiguous declarations and incomplete typecheck output', () => {
  const ambiguous = output();
  const definitions = ambiguous.modules[1]!.declarations;
  definitions.push({...definitions[2]!, id: 20});
  expect(discoverQuintDefinitions(ambiguous, selection).selected).toBeUndefined();
  expect(discoverQuintDefinitions({...output(), types: undefined}, selection).selected).toBeUndefined();
});

it('includes transitive resolved helpers in the invariant fingerprint and ignores IR numbering',()=>{
  const typed=(offset:number,limit:number)=>{
    const call={id:offset+4,kind:'app',opcode:'threshold',args:[]};
    const name={id:offset+6,kind:'name',name:'allowed'};
    const helper={id:offset+3,kind:'def',name:'threshold',qualifier:'puredef',expr:{id:offset+2,kind:'int',value:limit}};
    const allowed={id:offset+5,kind:'def',name:'allowed',qualifier:'val',expr:call};
    return {modules:[{name:'orders',declarations:[{id:offset+7,kind:'def',name:'safe',expr:name}]}],
      table:{[call.id]:helper,[name.id]:allowed}};
  };
  const fingerprint=(raw:unknown)=>quintInvariantFingerprint(raw,'orders','safe');
  const original=fingerprint(typed(0,3));
  expect(original).toMatch(/^[a-f0-9]{64}$/);
  expect(fingerprint(typed(20,3))).toBe(original);
  expect(fingerprint(typed(20,4))).not.toBe(original);
});
