import {test,expect} from 'vitest';
import {gzipSync} from 'node:zlib';
import {inspectArchive,validatePackage} from '../scripts/release.mjs';
const metadata=()=>({name:'@behavproof/core',version:'0.1.0',license:'UNLICENSED',publishConfig:{access:'public',registry:'https://registry.npmjs.org/'},files:['dist'],exports:{'.':'./dist/index.js'}});
function archive(entries:{name:string;body:string;type?:string}[]){
 const chunks:Buffer[]=[];
 for(const e of entries){const h=Buffer.alloc(512);h.write(e.name);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(Buffer.byteLength(e.body).toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write(e.type??'0',156);h.write('ustar\0',257);h.write('00',263);h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);const b=Buffer.from(e.body);chunks.push(h,b,Buffer.alloc((512-b.length%512)%512));}
 return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
test('inspects actual packed bytes and keeps the approved public registry and exact workspace versions',()=>{
 expect(validatePackage(metadata(),'0.1.0')).toBeUndefined();
 const files=inspectArchive(archive([{name:'package/package.json',body:JSON.stringify(metadata())},{name:'package/dist/index.js',body:'export const ok=true;'}]),metadata());
 expect(files).toEqual(['package/package.json','package/dist/index.js']);
 for(const bad of [{publishConfig:{access:'restricted',registry:'https://registry.npmjs.org/'}},{dependencies:{'@behavproof/core':'*'}},{scripts:{prepublishOnly:'curl example.invalid'}},{publishConfig:{access:'public',registry:'https://example.invalid/'}}])expect(()=>validatePackage({...metadata(),...bad},'0.1.0')).toThrow();
});
test('rejects credential payloads, unexpected files, duplicate entries and links',()=>{
 const base={name:'package/package.json',body:JSON.stringify(metadata())};
 for(const e of [{name:'package/.npmrc',body:'dummy'},{name:'package/dist/key.pem',body:'-----BEGIN PRIVATE KEY-----'},{name:'package/dist/index.js',body:'ghp_'+'a'.repeat(36)},{name:'package/../outside',body:''},{name:'package/dist/link.js',body:'',type:'2'},base])expect(()=>inspectArchive(archive([base,e]),metadata())).toThrow();
 expect(()=>inspectArchive(archive([{...base,body:JSON.stringify({...metadata(),version:'0.2.0'})}]),metadata())).toThrow();
});
test('rejects malformed tar checksums, truncation and oversized output',()=>{
 expect(()=>inspectArchive(Buffer.from('not gzip'),metadata())).toThrow();
 const huge=archive([{name:'package/dist/index.js',body:'x'.repeat(33*1024*1024)}]);
 expect(()=>inspectArchive(huge,metadata())).toThrow();
});

test('verifies immutable release archive identity and rejects tampering',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createHash}=await import('node:crypto');
 const {packageDirs,verifyRelease}=await import('../scripts/release.mjs');
 const root=await mkdtemp(join(tmpdir(),'behavproof-release-test-'));const packages=[];const commit='a'.repeat(40);const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 try{
  for(const dir of packageDirs){const p=JSON.parse(await readFile(new URL(`../packages/${dir}/package.json`,import.meta.url),'utf8'));const filename=p.name.replace('@','').replace('/','-')+'-'+p.version+'.tgz';const targets=new Set<string>();const add=(v:unknown)=>{if(typeof v==='string')targets.add('package/'+v.replace(/^\.\//,''));else if(v&&typeof v==='object')Object.values(v).forEach(add);};add(p.exports);add(p.bin);if(p.name==='@behavproof/cli')for(const asset of ['schemas/config.schema.json','schemas/ci-registration.schema.json','schemas/specification-registry.schema.json','schemas/quality-policy.schema.json','schemas/deployment.schema.json','schemas/trust-root.schema.json','presets/basic-v2.json','presets/standard-v2.json','presets/critical-v2.json','templates/audit.yml'])targets.add('package/'+asset);const entries=[{name:'package/package.json',body:JSON.stringify(p)},...[...targets].map(name=>({name,body:'fixture'}))];const bytes=archive(entries);await writeFile(join(root,filename),bytes);packages.push({name:p.name,filename,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),files:entries.map(e=>e.name)});}
  await writeFile(join(root,'release-manifest.json'),JSON.stringify({schemaVersion:1,version,access:'public',registry:'https://registry.npmjs.org/',sourceCommit:commit,packages}));
  await expect(verifyRelease(root,commit)).resolves.toMatchObject({sourceCommit:commit});
  await expect(verifyRelease(root,'b'.repeat(40))).rejects.toThrow('identity');
  await writeFile(join(root,packages[0].filename),Buffer.from('changed'));
  await expect(verifyRelease(root,commit)).rejects.toThrow('integrity');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('rejects archives with missing runtime or declaration entrypoints',()=>{
 expect(()=>inspectArchive(archive([{name:'package/package.json',body:JSON.stringify(metadata())}]),metadata())).toThrow('entrypoint');
 const p={...metadata(),exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}}};
 expect(()=>inspectArchive(archive([{name:'package/package.json',body:JSON.stringify(p)},{name:'package/dist/index.js',body:'export {}'}]),p)).toThrow('entrypoint');
});

test('forces npm scoped registry over a hostile user configuration',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const {npmArguments,npmCliPath}=await import('../scripts/release.mjs');const root=await mkdtemp(join(tmpdir(),'behavproof-registry-test-'));
 try{const config=join(root,'npmrc');await writeFile(config,'@behavproof:registry=https://example.invalid/\n');const cli=npmCliPath();
 const output=execFileSync(process.execPath,[cli,...npmArguments(['config','get','@behavproof:registry','--userconfig='+config])],{cwd:root,encoding:'utf8'}).trim();expect(output).toBe('https://registry.npmjs.org/');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('distinguishes npm phantom-private names from existing private packages',async()=>{
 const {publicReleaseState}=await import('../scripts/release.mjs');
 expect(publicReleaseState({visibility:'private',packageMissing:true,listed:false,owner:true})).toBe('new');
 expect(publicReleaseState({visibility:'public',packageMissing:false,listed:true,owner:false})).toBe('existing');
 for(const value of [
  {visibility:'private',packageMissing:false,listed:true,owner:true},
  {visibility:'private',packageMissing:true,listed:true,owner:true},
  {visibility:'private',packageMissing:true,listed:false,owner:false},
  {visibility:'unknown',packageMissing:true,listed:false,owner:true},
 ])expect(()=>publicReleaseState(value)).toThrow();
});

test('recognizes an owner-visible public name awaiting registry scanning without permitting private publication',async()=>{
 const {publicReleaseState}=await import('../scripts/release.mjs');
 expect(publicReleaseState({visibility:'public',packageMissing:true,listed:true,owner:true})).toBe('pending');
 expect(()=>publicReleaseState({visibility:'public',packageMissing:true,listed:false,owner:true})).toThrow();
});
test('waits for every queued package and never treats acceptance as verified availability',async()=>{
 const {waitForPublications}=await import('../scripts/release.mjs');let time=0;const seen:string[]=[];
 const rows=[{name:'a',integrity:'hash-a'},{name:'b',integrity:'hash-b'}];
 await waitForPublications(rows,{read:async row=>{seen.push(row.name);return time>=(row.name==='a'?1:2)?{visibility:'public',integrity:row.integrity}:undefined;},now:()=>time,pause:async()=>{time++;},pollMs:1,timeoutMs:5});
 expect(time).toBe(2);expect(seen).toEqual(['a','b','a','b','b']);
 await expect(waitForPublications(rows,{read:async()=>undefined,now:()=>time,pause:async()=>{time++;},pollMs:1,timeoutMs:2})).rejects.toThrow('still pending');
 for(const bad of [{visibility:'private',integrity:'hash-a'},{visibility:'public',integrity:'different'}])await expect(waitForPublications([rows[0]],{read:async()=>bad,now:()=>0,pause:async()=>{},pollMs:1,timeoutMs:2})).rejects.toThrow('verification failed');
});
