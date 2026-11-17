import {expect,it} from 'vitest';
import {hash,ConfigSchema} from '../../packages/core/src/index.js';
import {discoverSources} from '../../packages/contract-registry/src/discovery.js';
const declaration={id:'JEST',intent:'double numbers',risk:'basic',cases:[{id:'one',input:1,expected:2}]};
it.each([
 `import {defineContract as contract} from '@behavproof/jest'; const c=contract(${JSON.stringify(declaration)});`,
 `const {defineContract:contract}=require('@behavproof/jest');const c=contract(${JSON.stringify(declaration)});`,
 `const {defineContract}=require('@behavproof/jest');const c=defineContract(${JSON.stringify(declaration)});`,
])('discovers official static Jest declarations without executing them: %s',source=>{
 const result=discoverSources([{kind:'jest-inline',ref:'test.cjs',content:source+"\nthrow Error('must not execute discovery');"}]);
 expect(result.diagnostics).toEqual([]);expect(result.contracts).toHaveLength(1);expect(result.contracts[0]).toMatchObject({id:'JEST',revisionHash:hash(declaration),caseIds:['one']});
});
it('retains dynamic or computed Jest declarations as incomplete',()=>{
 const result=discoverSources([{kind:'jest-inline',ref:'test.cjs',content:"const {defineContract}=require('@behavproof/jest');const d=JSON.parse('{}');const c=defineContract(d);"}]);
 expect(result.contracts).toEqual([]);expect(result.diagnostics.length).toBeGreaterThan(0);
});
it('adds optional Jest configuration without adding legacy default fields',()=>{
 const old=ConfigSchema.parse({schemaVersion:1});expect(old).not.toHaveProperty('testRunner');expect(old.reports).not.toHaveProperty('jest');
 const next=ConfigSchema.parse({schemaVersion:1,testRunner:'jest',reports:{jest:'.behavproof/input/jest.json'},contracts:{sources:[{type:'jest-inline',include:['tests/**/*.ts']}]}});
 expect(next.testRunner).toBe('jest');expect(next.reports.jest).toBe('.behavproof/input/jest.json');
 expect(()=>ConfigSchema.parse({schemaVersion:1,testRunner:'unverified'})).toThrow();
});
