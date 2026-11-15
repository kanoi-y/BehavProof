import { parseUntypedTrace, transformITFValue } from '@firfi/itf-trace-parser';
import { canonicalJson, hash, type ReplayStep } from '@behavproof/core';
type Json=ReplayStep['expected'];
const MAX_BYTES=10*1024*1024;
const compare=(a:unknown,b:unknown)=>{const x=canonicalJson(a),y=canonicalJson(b);return x<y?-1:x>y?1:0;};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
/** Canonical JSON encoding of native ITF values. Precision and set/map meaning
 * survive serialization; arbitrary objects/getters/cycles are not evidence. */
export function toFormalJson(input:unknown):Json{
 const seen=new Set<object>();let nodes=0;
 const visit=(v:unknown,depth:number):Json=>{
  if(depth>64||++nodes>100000)throw Error('Formal value depth/node limit exceeded');
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Non-finite formal value');return v;}
  if(typeof v==='bigint')return {'#bigint':v.toString()};
  if(typeof v!=='object'||seen.has(v))throw Error('Unsupported/cyclic formal value');seen.add(v);
  try{
   if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
   if(v instanceof Set)return {'#set':[...v].map(x=>visit(x,depth+1)).sort(compare)};
   if(v instanceof Map)return {'#map':[...v].map(([k,value])=>[visit(k,depth+1),visit(value,depth+1)]).sort((a,b)=>compare(a[0],b[0]))};
   if(!plain(v))throw Error('Expected plain formal snapshot');
   const out:Record<string,Json>=Object.create(null);
   for(const key of Object.keys(v).sort()){
    const d=Object.getOwnPropertyDescriptor(v,key)!;if(!('value' in d))throw Error('Formal snapshot accessors are unsupported');
    if(['__proto__','prototype','constructor'].includes(key))throw Error('Reserved formal value field');
    if(key==='#unserializable')throw Error('Unsupported unserializable formal value');
    out[key]=visit(d.value,depth+1);
   }
   return out;
  }finally{seen.delete(v);}
 };
 const result=visit(input,0);if(Buffer.byteLength(canonicalJson(result))>MAX_BYTES)throw Error('Formal value size limit exceeded');return result;
}
export type ReplayInputTrace={id:string;steps:{index:number;action:string;parameters:Json;expected:Json}[]};
export function readITF(input:unknown,options:{id?:string;maxBytes?:number}={}):ReplayInputTrace{
 const max=options.maxBytes??MAX_BYTES;if(!Number.isSafeInteger(max)||max<1||max>MAX_BYTES)throw Error('Invalid trace size limit');
 // Check depth/accessors before the external value decoder traverses data.
 const value=toFormalJson(input);if(Buffer.byteLength(canonicalJson(value))>max)throw Error('ITF size limit exceeded');
 if(!plain(value))throw Error('Expected ITF object');
 const trace=parseUntypedTrace(value),vars=trace.vars;
 if(vars.length>1000||new Set(vars).size!==vars.length||trace.states.length>10001)throw Error('ITF inventory limit or duplicate variables');
 if(!vars.includes('mbt::actionTaken')||!vars.includes('mbt::nondetPicks'))throw Error('ITF action metadata unavailable; generate with --mbt');
 const names=vars.filter(v=>!v.startsWith('mbt::'));
 const steps=trace.states.map((state,index)=>{
  if(!plain(state))throw Error('Invalid ITF state fields');
  const meta=state['#meta'];if(!plain(meta)||meta.index!==index)throw Error('ITF state index mismatch');
  for(const name of vars)if(!Object.hasOwn(state,name))throw Error(`ITF variable missing: ${name}`);
  for(const name of Object.keys(state))if(name!=='#meta'&&!vars.includes(name))throw Error('Unexpected ITF state variable');
  const action=state['mbt::actionTaken'];if(typeof action!=='string'||!action)throw Error('ITF action metadata unavailable');
  if(index===0&&action!=='init')throw Error('ITF initial action must be init');
  const expected=Object.fromEntries(names.map(name=>[name,state[name]]));
  return {index,action,parameters:toFormalJson(transformITFValue(state['mbt::nondetPicks'])),expected:toFormalJson(transformITFValue(expected))};
 });
 return {id:options.id??`trace-${hash(steps).slice(0,16)}`,steps};
}
export const decodeFormalParameters=(value:Json):unknown=>transformITFValue(structuredClone(value));
