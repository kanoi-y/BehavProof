/** Restricted npm releases. Never builds or runs package lifecycle scripts with publishing credentials. */
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const packageDirs=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','adapter-quint','adapter-model-test','cli'];
const registry='https://registry.npmjs.org/';
const sha512=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
export function validatePackage(p,version){
 if(!/^@behavproof\/[a-z-]+$/.test(p.name)||p.version!==version||!/^\d+\.\d+\.\d+$/.test(version)||p.private||p.license!=='UNLICENSED')throw Error('Invalid release metadata');
 if(p.publishConfig?.access!=='restricted'||p.publishConfig?.registry!==registry||Object.keys(p.publishConfig).some(k=>!['access','registry'].includes(k)))throw Error('Release must use the restricted npm registry');
 if(p.scripts&&Object.keys(p.scripts).length||p.bundledDependencies||p.bundleDependencies)throw Error('Package lifecycle scripts and bundled dependencies are prohibited');
 for(const group of ['dependencies','peerDependencies','optionalDependencies'])for(const [name,range] of Object.entries(p[group]??{}))if(name.startsWith('@behavproof/')&&range!==version)throw Error('Internal version mismatch');
 if(!Array.isArray(p.files)||!p.files.length||p.files.some(f=>!['dist','schemas','presets','templates'].includes(f)))throw Error('Invalid package allowlist');
}
export function inspectArchive(bytes,expected){
 if(bytes.length>10*1024*1024)throw Error('Archive too large');
 const tar=gunzipSync(bytes,{maxOutputLength:32*1024*1024}),files=[],seen=new Set();let offset=0,packaged;
 const text=(b)=>new TextDecoder('utf-8',{fatal:true}).decode(b);
 const field=(h,start,end)=>text(h.subarray(start,end)).split('\0')[0];
 const octal=s=>{if(!/^[0-7]+$/.test(s.trim()))throw Error('Malformed tar number');return parseInt(s.trim(),8);};
 while(offset+512<=tar.length){
  const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0)){if(tar.subarray(offset).some(b=>b!==0))throw Error('Unexpected trailing tar data');break;}
  const checksum=octal(field(h,148,156)),copy=Buffer.from(h);copy.fill(32,148,156);if([...copy].reduce((a,b)=>a+b,0)!==checksum)throw Error('Invalid tar checksum');
  const prefix=field(h,345,500),name=(prefix?prefix+'/':'')+field(h,0,100),size=octal(field(h,124,136)),type=field(h,156,157);
  if(!['','0'].includes(type)||!/^package\/(?:package\.json|README(?:\.md)?|(?:dist|schemas|presets|templates)\/.+)$/.test(name)||name.split('/').some(p=>['.','..',''].includes(p))||name.includes('\\')||seen.has(name))throw Error('Unsafe or unexpected packed file');
  if(!Number.isSafeInteger(size)||size>10*1024*1024||offset+512+size>tar.length)throw Error('Invalid tar payload bounds');
  seen.add(name);files.push(name);const body=tar.subarray(offset+512,offset+512+size),content=text(body);
  if(/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|[^/]*\.(?:pem|key|p12|pfx))$/i.test(name)||/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|npm_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b/.test(content))throw Error('Credential-shaped payload in '+name);
  if(name==='package/package.json')packaged=JSON.parse(content);
  offset+=512+Math.ceil(size/512)*512;
 }
 if(offset+1024>tar.length||!packaged||JSON.stringify(packaged)!==JSON.stringify(expected))throw Error('Packaged metadata or tar termination mismatch');
 const targets=[];
 const collect=value=>{if(typeof value==='string')targets.push(value);else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);};
 collect(packaged.exports);collect(packaged.main);collect(packaged.types);collect(packaged.bin);
 if(!targets.length||!targets.some(t=>t.endsWith('.js')))throw Error('Missing executable package entrypoint');
 for(const target of targets){if(!target.startsWith('./')||!seen.has('package/'+target.slice(2)))throw Error('Missing packed entrypoint: '+target);}
 if(packaged.name==='@behavproof/cli')for(const file of ['schemas/config.schema.json','schemas/registration.schema.json','schemas/trust-root.schema.json','presets/basic-v1.json','presets/standard-v1.json','presets/critical-v1.json','templates/audit.yml','templates/protected-github-producer.yml','templates/protected-github-publisher.yml'])if(!seen.has('package/'+file))throw Error('Missing CLI asset: '+file);
 return files;
}
const project=fileURLToPath(new URL('..',import.meta.url));
const run=(bin,args)=>execFileSync(bin,args,{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:10*1024*1024});
const git=(...args)=>run('git',['-c','core.fsmonitor=false',...args]).trim();
export const npmCliPath=()=>{const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];const cli=candidates.find(p=>p&&existsSync(p));if(!cli)throw Error('Installed npm CLI entrypoint not found; invoke via npm run release');return cli;};
export const npmArguments=args=>[...args,'--registry='+registry,'--@behavproof:registry='+registry];
const npm=(...args)=>{
 const cli=npmCliPath();
 if(args[0]==='publish'){
  try{return execFileSync(process.execPath,[cli,...npmArguments(args)],{cwd:project,encoding:'utf8',stdio:'inherit',timeout:300000});}
  catch{throw Error('npm publish failed. If 2FA is required, rerun this command in an interactive administrator terminal; no public fallback was attempted.');}
 }
 return run(process.execPath,[cli,...npmArguments(args)]);
};
export async function verifyRelease(directory,expectedCommit){
 const manifest=JSON.parse(await readFile(join(directory,'release-manifest.json'),'utf8'));
 if(manifest.schemaVersion!==1||manifest.access!=='restricted'||manifest.registry!==registry||manifest.sourceCommit!==expectedCommit||!/^[a-f0-9]{40}$/.test(expectedCommit)||manifest.packages?.length!==packageDirs.length)throw Error('Invalid release identity');
 for(const [index,dir] of packageDirs.entries()){
  const p=JSON.parse(await readFile(join(project,'packages',dir,'package.json'),'utf8'));validatePackage(p,manifest.version);
  const row=manifest.packages[index],filename=p.name.replace('@','').replace('/','-')+'-'+p.version+'.tgz';
  if(row.name!==p.name||row.filename!==filename)throw Error('Release package order mismatch');
  const path=join(directory,filename),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe archive');
  const bytes=await readFile(path);if(sha512(bytes)!==row.integrity)throw Error('Release archive integrity mismatch');
  if(JSON.stringify(inspectArchive(bytes,p))!==JSON.stringify(row.files))throw Error('Release inventory mismatch');
 }
 return manifest;
}
async function main(){
 const [command,output,expectedCommit]=process.argv.slice(2);if(!['prepare','verify','publish'].includes(command)||!output)throw Error('Usage: node scripts/release.mjs prepare|verify|publish DIRECTORY [EXACT_SOURCE_SHA]');
 const directory=resolve(output),sourceCommit=git('rev-parse','HEAD');
 if(git('status','--porcelain','--untracked-files=normal'))throw Error('Release requires a clean checkout');
 if(command==='prepare'){
  const {version}=JSON.parse(await readFile(join(project,'package.json'),'utf8'));await mkdir(directory,{recursive:false});const packages=[];
  for(const dir of packageDirs){const p=JSON.parse(await readFile(join(project,'packages',dir,'package.json'),'utf8'));validatePackage(p,version);
   const [meta]=JSON.parse(npm('pack','--workspace='+p.name,'--ignore-scripts','--json','--cache',join(project,'.npm-cache'),'--pack-destination',directory));
   const bytes=await readFile(join(directory,meta.filename));packages.push({name:p.name,filename:meta.filename,integrity:sha512(bytes),files:inspectArchive(bytes,p)});
  }
  await writeFile(join(directory,'release-manifest.json'),JSON.stringify({schemaVersion:1,version,sourceCommit,registry,access:'restricted',packages},null,2)+'\n',{flag:'wx',mode:0o600});
 }else{
  if(expectedCommit!==sourceCommit)throw Error('Checkout differs from the exact release source');
  const manifest=await verifyRelease(directory,expectedCommit);
  if(command==='publish'){
   // No public fallback, automatic payment, staging placeholders or latest promotion.
   const snapshot=await mkdtemp(join(tmpdir(),'behavproof-release-'));
   try{
   for(const row of manifest.packages){const bytes=await readFile(join(directory,row.filename));if(sha512(bytes)!==row.integrity)throw Error('Release changed before snapshot');await writeFile(join(snapshot,row.filename),bytes,{flag:'wx',mode:0o600});}
   const username=npm('whoami','--registry='+registry).trim();if(!username)throw Error('npm login required');
   console.log('Publishing restricted packages as '+username);
   for(const row of manifest.packages){
    // Refuse to release a new version of an existing public package.
    let visibility;try{visibility=JSON.parse(npm('access','get','status',row.name,'--json','--registry='+registry));}catch(error){if(!/E404/.test(String(error.stderr)))throw Error('Cannot establish package visibility; refusing publication');}
    if(visibility&&visibility[row.name]!=='private')throw Error('Existing package is not restricted');
    const bytes=await readFile(join(snapshot,row.filename));if(sha512(bytes)!==row.integrity)throw Error('Archive changed before publication');
    let existing;try{existing=JSON.parse(npm('view',row.name+'@'+manifest.version,'dist.integrity','--json','--registry='+registry));}catch(error){if(!/E404/.test(String(error.stderr)))throw Error('Cannot inspect existing version');}
    if(existing&&existing!==row.integrity)throw Error('Existing version differs; versions cannot be overwritten');
    if(!existing)npm('publish',join(snapshot,row.filename),'--access=restricted','--tag=next','--ignore-scripts','--registry='+registry);
    const status=JSON.parse(npm('access','get','status',row.name,'--json','--registry='+registry));
    const integrity=JSON.parse(npm('view',row.name+'@'+manifest.version,'dist.integrity','--json','--registry='+registry));
    if(status[row.name]!=='private'||integrity!==row.integrity)throw Error('Published package verification failed');
    console.log(row.name+'@'+manifest.version+': restricted, integrity verified');
   }
   }finally{await rm(snapshot,{recursive:true,force:true});}
  }
 }
 console.log('Release '+command+' completed');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
