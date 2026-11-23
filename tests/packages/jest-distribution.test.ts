import {test,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,unlink,access,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateStagedSdk} from '../../scripts/staged-sdk.mjs';
import {validatePackage,inspectArchive,packageDirs,npmCliPath} from '../../scripts/release.mjs';

const stage=(output:string,built=false)=>execFileSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs',...(built?['--built']:[]),'--output',output],{cwd:resolve('.'),stdio:'pipe',timeout:120000});
test('source SDK includes the native Jest inputs and exact core CommonJS build inputs',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-jest-source-')),output=join(scratch,'sdk');
 try{
  stage(output);
  const inventory=JSON.parse(await readFile(join(output,'sdk-source-inventory.json'),'utf8'));
  for(const path of ['scripts/build-commonjs.mjs','packages/core/cjs/package.json','packages/adapter-reports/package.json','packages/adapter-reports/tsconfig.json','packages/adapter-reports/src/jest-inventory-reporter.cts']){
   expect(inventory.files.map((file:{path:string})=>file.path)).toContain(path);
   expect(await readFile(join(output,path),'utf8')).toBe(await readFile(path,'utf8'));
  }
  await expect(access(join(output,'packages/adapter-reports/dist/jest-inventory-reporter.cjs'))).rejects.toThrow();
 }finally{await rm(scratch,{recursive:true,force:true});}
},30000);

test.skipIf(process.platform==='win32')('built SDK verifies native CJS bytes and excludes undeclared CJS artifacts',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-jest-built-')),output=join(scratch,'sdk');
 try{
  stage(output,true);
  await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).resolves.toMatchObject({path:await realpath(output)});
  const inventory=JSON.parse(await readFile(join(output,'sdk-source-inventory.json'),'utf8'));
  for(const path of ['packages/core/cjs/dist/index.js','packages/core/cjs/dist/index.d.ts','packages/adapter-reports/dist/jest-inventory-reporter.cjs','packages/adapter-reports/dist/jest-inventory-reporter.cjs.map','packages/adapter-reports/dist/jest-inventory-reporter.d.cts','packages/adapter-reports/dist/jest-inventory-reporter.d.cts.map'])expect(inventory.files.map((file:{path:string})=>file.path)).toContain(path);
  execFileSync(process.execPath,['--input-type=commonjs','-e',`const {hash}=require('@behavproof/core');if(hash({}).length!==64)throw Error('CJS core missing');if(typeof require('@behavproof/adapter-reports/jest-inventory-reporter')!=='function')throw Error('Jest inventory reporter missing');`],{cwd:output,stdio:'pipe'});
  for(const path of ['packages/core/cjs/dist/private.js','packages/adapter-reports/dist/private.cjs']){
   await writeFile(join(output,path),'controlled private fixture');
   await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).rejects.toThrow(/private|unlisted/i);
   await unlink(join(output,path));
  }
  // Even a self-consistent edited inventory cannot select different executable bytes.
  for(const path of ['packages/adapter-reports/dist/jest-inventory-reporter.cjs','packages/core/cjs/dist/index.js']){
   const original=await readFile(join(output,path)),changed='module.exports = {};';
   await writeFile(join(output,path),changed);
   const row=inventory.files.find((file:{path:string})=>file.path===path),prior={...row};
   row.sha256=createHash('sha256').update(changed).digest('hex');row.size=Buffer.byteLength(changed);
   await writeFile(join(output,'sdk-source-inventory.json'),JSON.stringify(inventory));
   await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).rejects.toThrow(/executable differs/i);
   await writeFile(join(output,path),original);Object.assign(row,prior);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
},120000);

test('release validation accepts actual dual-module and native Jest archives without adding publication approval',async()=>{
 expect(packageDirs).not.toContain('contract-jest');
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-cjs-pack-'));
 try{
  const cli=npmCliPath();
  for(const name of ['core','adapter-reports']){
   const metadata=JSON.parse(await readFile(`packages/${name}/package.json`,'utf8'));
   expect(()=>validatePackage(metadata,metadata.version)).not.toThrow();
   const [pack]=JSON.parse(execFileSync(process.execPath,[cli,'pack','--ignore-scripts','--json','--cache',resolve('.npm-cache'),'--pack-destination',scratch],{cwd:resolve('packages',name),encoding:'utf8'}));
   const files=inspectArchive(await readFile(join(scratch,pack.filename)),metadata);
   for(const file of name==='core'?['cjs/package.json','cjs/dist/index.js']:['dist/jest-inventory-reporter.cjs','dist/jest-inventory-reporter.d.cts'])expect(files).toContain('package/'+file);
  }
  expect(()=>validatePackage({name:'@behavproof/cli',version:'0.1.0',license:'UNLICENSED',publishConfig:{access:'public',registry:'https://registry.npmjs.org/'},files:['cjs/dist']},'0.1.0')).toThrow('allowlist');
 }finally{await rm(scratch,{recursive:true,force:true});}
},30000);
