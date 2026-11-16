import{it,expect}from'vitest';import{spawnSync}from'node:child_process';import{resolve}from'node:path';
it('verifies consumer conditions through real collectors, protected gate, faults and review output',()=>{
 const r=spawnSync(process.execPath,[resolve('scripts/assurance-flow.mjs')],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 expect(r.status,r.stderr+r.stdout).toBe(0);const evidence=JSON.parse(r.stdout);
 expect(evidence.correct).toMatchObject({gateExit:0,status:'pass',conditions:6,faults:6});
 expect(evidence.refactor).toMatchObject({gateExit:0,status:'pass'});
 for(const name of ['missing','stale','driverChanged','conditionRemoved','scopeWeakened','duplicate','criteriaUnbound'])expect(evidence[name].gateExit,name).toBe(1);
 expect(evidence.map).toMatchObject({verifiedConditions:6,containsScopes:true,documentsVerified:true});
 expect(evidence.producer).toBe('real Vitest + explicit assurance worker + Collector');
},120000);
