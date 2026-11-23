import {z} from 'zod';
import {RelativePathSchema,safeRead} from '@behavproof/core';

const maxEvidenceBytes=6*1024*1024;
export const maxEvidenceFiles=10000;
const envelope=z.strictObject({
  schemaVersion:z.literal(1),
  files:z.array(z.strictObject({ref:RelativePathSchema,content:z.string()})).max(maxEvidenceFiles),
});

export async function collectEvidenceFiles(root:string,inventory:Iterable<string>,files=new Map<string,Buffer>()){
  let remaining=maxEvidenceBytes-[...files.values()].reduce((size,bytes)=>size+bytes.length,0);
  for(const ref of inventory){
    let bytes:Buffer;
    try{bytes=await safeRead(root,ref,remaining);}
    catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')continue;
      throw error;
    }
    remaining-=bytes.length;
    if(!bytes.length)continue;
    files.set(ref,bytes);
  }
  return files;
}
export function encodeEvidenceFiles(files:ReadonlyMap<string,Buffer>){
  return Buffer.from(JSON.stringify({schemaVersion:1,
    files:[...files].map(([ref,bytes])=>({ref,content:bytes.toString('base64')})),
  }));
}

/** Called on bytes supplied by the authenticated host manifest, never by the candidate config. */
export function embeddedEvidenceFiles(bytes:Uint8Array,inventory:ReadonlySet<string>):ReadonlyMap<string,Buffer>{
  const parsed=envelope.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  const files=new Map<string,Buffer>();
  let remaining=maxEvidenceBytes;
  for(const {ref,content} of parsed.files){
    if(!inventory.has(ref)||files.has(ref))throw Error(`Unexpected or duplicate hosted evidence: ${ref}`);
    const decoded=Buffer.from(content,'base64');
    if(!decoded.length||decoded.toString('base64')!==content||(remaining-=decoded.length)<0){
      throw Error(`Invalid hosted evidence encoding or size: ${ref}`);
    }
    files.set(ref,decoded);
  }
  return files;
}
