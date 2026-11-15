import { expect,it } from 'vitest';
import { discoverSources } from '../../packages/contract-registry/src/index.js';
const digest='a'.repeat(64),changed='b'.repeat(64);
const manifest={id:'ORDER-MODEL',kind:'state_machine',intent:'Refund at most once',risk:'basic',cases:[],formal:{modelId:'ORDER',modelHash:digest,propertyIds:['refundAtMostOnce']}};
const discover=(value:unknown,ref='contract.json')=>discoverSources([{kind:'manifest',ref,content:JSON.stringify(value)}]);
it('binds a statically declared state-machine Contract to the exact model and properties',()=>{
 const result=discover(manifest);expect(result.diagnostics).toEqual([]);
 expect(result.contracts[0]).toMatchObject({kind:'state_machine',formal:{modelId:'ORDER',modelHash:digest,propertyIds:['refundAtMostOnce']}});
});
it('changes the reviewable Contract revision when the declared model hash or properties change',()=>{
 const original=discover(manifest).contracts[0]!.revisionHash;
 for(const formal of [{...manifest.formal,modelHash:changed},{...manifest.formal,propertyIds:['otherProperty']}])expect(discover({...manifest,formal}).contracts[0]!.revisionHash).not.toBe(original);
 expect(discover(manifest,'moved.json').contracts[0]!.revisionHash).toBe(original);
});
it('does not silently discard malformed formal metadata or an unknown Contract kind',()=>{
 for(const value of [{...manifest,kind:'something-new'},{...manifest,formal:{...manifest.formal,modelHash:'not-a-hash'}}]){
  const result=discover(value);expect(result.contracts).toEqual([]);expect(result.diagnostics.length).toBeGreaterThan(0);
 }
});
it('preserves pre-formal manifest revision hashes',()=>{
 expect(discover({id:'ORDER-MODEL',intent:'Refund at most once',risk:'basic',cases:[]}).contracts[0]!.revisionHash).toBe('348757b0b92ab4ace5cce4fede4df1288861aedecea0e1ae38a468b4831d597f');
});
