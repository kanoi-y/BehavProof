import {test,expect} from 'vitest';
import {parseConfig,mergeProtectedPolicy,getProfilePolicy} from '../../packages/core/src/index.js';
import {normalizeStryker} from '../../packages/adapter-reports/src/index.js';
import {scopedEvaluations} from '../../packages/cli/src/scopes.js';
const source='export const readOrder = () => true;';
const mutation=normalizeStryker({schemaVersion:'1.0',files:{'src/order.ts':{source,mutants:[{id:'1',status:'Killed',location:{start:{line:1},end:{line:1}}}]}}});
function evaluate(configured:number,protectedMinimum:number){
 const config=parseConfig({schemaVersion:2,profile:'critical',riskOverrides:[{selector:{kind:'path',value:'src/order.ts'},profile:'critical'}],rules:{mutationScore:{severity:'error',minMutants:configured}}});
 const protectedPolicy=getProfilePolicy('critical');protectedPolicy.rules.mutationScore!.minMutants=protectedMinimum;
 const policy=mergeProtectedPolicy({schemaVersion:1,profileVersion:'2',rules:config.rules},protectedPolicy);
 return scopedEvaluations({config,policy,files:['src/order.ts'],states:new Map(),mutation,coverageTrusted:false,mutationTrusted:true,mapping:true,changed:{'src/order.ts':[1]},sources:{'src/order.ts':source}}).find(e=>e.ruleId==='mutationScore');
}
test('scoped mutation uses explicitly configured and protected numerical parameters',()=>{
 expect(evaluate(1,1)?.status).toBe('pass');
});
test('scoped mutation retains the greater protected or project minimum',()=>{
 expect(evaluate(1,10)?.status).toBe('unknown');
 expect(evaluate(3,1)?.status).toBe('unknown');
});
test('critical protected path keeps mandatory severity after configurable thresholds',()=>{
 const config=parseConfig({schemaVersion:2,profile:'basic',rules:{mutationScore:{severity:'off',minMutants:1}}});
 const evaluations=scopedEvaluations({config,policy:{schemaVersion:1,profileVersion:'2',rules:config.rules},protectedConfig:parseConfig({schemaVersion:2,riskOverrides:[{selector:{kind:'path',value:'src/**'},profile:'critical'}]}),files:['src/order.ts'],states:new Map(),coverageTrusted:false,mutationTrusted:false,mapping:false,changed:{},sources:{}});
 expect(evaluations.find(e=>e.ruleId==='mutationScore')).toMatchObject({severity:'error',status:'unknown'});
});
