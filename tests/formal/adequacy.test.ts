import {expect, it} from 'vitest';
import {evaluateFormalAdequacy, formalWitnessCommandHash} from '../../packages/core/src/index.js';

const hash = (char: string) => char.repeat(64);
const identity = {modelHash:hash('a'),configHash:hash('b'),commandHash:hash('c')};
const expected = {modelId:'orders', identity, authenticated:true, names:['refunded'],
  backendVersion:'0.62.4', toolVersion:'0.33.1', maxSteps:8};
const witness = {name:'refunded', method:'bounded_model_check', maxSteps:8,
  commandHash:formalWitnessCommandHash(identity.commandHash,'refunded'),
  outcome:'found', trace:[{refunds:0},{refunds:1}]};
const report = {schemaVersion:1, modelId:'orders', identity, backendVersion:'0.62.4',
  toolVersion:'0.33.1', witnesses:[witness]};

it('distinguishes a positive bounded witness, bounded absence, and timeout', () => {
  expect(evaluateFormalAdequacy(report,expected)[0]?.status).toBe('pass');
  expect(evaluateFormalAdequacy({...report,witnesses:[{...witness,outcome:'not_found',trace:undefined}]},expected)[0]?.status).toBe('fail');
  expect(evaluateFormalAdequacy({...report,witnesses:[{...witness,outcome:'unknown',trace:undefined}]},expected)[0]?.status).toBe('unknown');
});

it('does not substitute stale or incomplete evidence for the required witness', () => {
  for(const row of [
    {...witness,trace:[]},
    {...witness,maxSteps:7},
    {...witness,commandHash:hash('f')},
    {...witness,name:'different'},
    {...witness,trace:Array.from({length:10},()=>({}))},
  ]){
    const got=evaluateFormalAdequacy({...report,witnesses:[row]},expected);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({name:'refunded',status:'unknown'});
  }
  expect(evaluateFormalAdequacy(report,{...expected,authenticated:false})[0]?.status).toBe('unknown');
  expect(evaluateFormalAdequacy(report,{...expected,identity:{...identity,modelHash:hash('f')}})[0]?.status).toBe('unknown');
});

it('distinguishes semantic mutant detection, survival, invalid variants and unavailable checks', async () => {
  const {evaluateSpecificationMutants,formalMutantCommandHash}=await import('../../packages/core/src/index.js');
  const expectedVariant={id:'double-refund',invariant:'safe',modelHash:hash('e')};
  const mutant={...expectedVariant, maxSteps:8,
    commandHash:formalMutantCommandHash(identity.commandHash,expectedVariant),
    outcome:'detected', trace:[{refunds:0},{refunds:2}]};
  const inputs={...expected,mutants:[expectedVariant]};
  for(const [outcome,status] of [['detected','pass'],['survived','fail'],['invalid','unknown'],['unknown','unknown']]){
    const row={...mutant,outcome,...(outcome==='detected'?{}:{trace:undefined})};
    expect(evaluateSpecificationMutants({...report,mutants:[row]},inputs)[0]?.status).toBe(status);
  }
  expect(evaluateSpecificationMutants({...report,mutants:[{...mutant,modelHash:hash('f')}]},inputs)[0]?.status).toBe('unknown');
  expect(evaluateSpecificationMutants({...report,mutants:[{...mutant,trace:[]}]},inputs)[0]?.status).toBe('unknown');
});
