// Host-owned selectors. No candidate file can change product/consumer ownership.
export function consumerFixture(name='pdd-acceptance'){
 const prefix='validation/behavproof-probe';
 if(name==='pdd-acceptance')return {name,files:['README.md','behavproof.config.json','policy.json','tests/acceptance.contract.ts'],project:{projectPath:'.',configRef:prefix+'/behavproof.config.json',policyRef:prefix+'/policy.json',targetRef:'src/verification/acceptance.ts#canAcceptEvidence',contractRef:prefix+'/tests/acceptance.contract.ts'},sourceRefs:[prefix+'/policy.json',prefix+'/behavproof.config.json',prefix+'/tests/acceptance.contract.ts','src/verification/acceptance.ts','package.json','pnpm-lock.yaml'],policyId:'pdd-acceptance-v1'};
 if(name==='enforcement-probe')return {name,files:['README.md','behavproof.config.json','package.json','policy.json','src/status.ts','tests/status.test.ts'],project:{projectPath:prefix,policyRef:prefix+'/policy.json',targetRef:prefix+'/src/status.ts#status',contractRef:prefix+'/tests/status.test.ts'},sourceRefs:[prefix+'/policy.json',prefix+'/behavproof.config.json',prefix+'/tests/status.test.ts',prefix+'/src/status.ts',prefix+'/package.json'],policyId:'enforcement-probe-v1'};
 throw Error('Unknown reviewed consumer fixture');
}
