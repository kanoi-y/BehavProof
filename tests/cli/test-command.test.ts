import{beforeEach,afterEach,test,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm,symlink}from'node:fs/promises';
import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';
const project=resolve('.'),binary=join(project,'packages/cli/dist/index.js');let root:string;
const run=()=>spawnSync(process.execPath,[binary,'test'],{cwd:root,encoding:'utf8',timeout:30000});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof-test-command-'));await writeFile(join(root,'package.json'),JSON.stringify({name:'sample',type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0','@behavproof/vitest':'0.1.0'}}));await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');await mkdir(join(root,'tests'));await writeFile(join(root,'tests/example.test.ts'),"import{defineContract,contractTest}from'@behavproof/vitest';const c=defineContract({id:'DOUBLE',intent:'double',risk:'basic',cases:[{id:'one',input:2,expected:4}]});contractTest.each(c,({input})=>input*2);\n");});
afterEach(()=>rm(root,{recursive:true,force:true}));
test('one command creates fresh Vitest and Contract reports, and reruns without stale content',async()=>{
 for(let i=0;i<2;i++){if(i)await writeFile(join(root,'.behavproof/input/contracts.json'),'stale');const result=run();expect(result.status,result.stderr+result.stdout).toBe(0);const v=JSON.parse(await readFile(join(root,'.behavproof/input/vitest.json'),'utf8')),c=JSON.parse(await readFile(join(root,'.behavproof/input/contracts.json'),'utf8'));expect(v.numPassedTests).toBe(1);expect(c.contracts).toHaveLength(1);expect(c.contracts[0].status).toBe('pass');}
});
test('real test failures return nonzero and replace old successful reports',async()=>{
 expect(run().status).toBe(0);await writeFile(join(root,'tests/example.test.ts'),"import{test,expect}from'vitest';test('fails',()=>expect(1).toBe(2));");const result=run();expect(result.status).toBe(1);const v=JSON.parse(await readFile(join(root,'.behavproof/input/vitest.json'),'utf8'));expect(v.numFailedTests).toBe(1);const c=JSON.parse(await readFile(join(root,'.behavproof/input/contracts.json'),'utf8'));expect(c.contracts).toHaveLength(0);
});
test('respects configured Vitest report inside the managed directory',async()=>{
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,reports:{vitest:'.behavproof/custom/vitest.json'}}));const result=run();expect(result.status,result.stderr+result.stdout).toBe(0);expect(JSON.parse(await readFile(join(root,'.behavproof/custom/vitest.json'),'utf8')).numPassedTests).toBe(1);
});
test('refuses unmanaged output paths before deleting project files',async()=>{
 await writeFile(join(root,'source.json'),'keep');await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,reports:{vitest:'source.json'}}));expect(run().status).toBe(2);expect(await readFile(join(root,'source.json'),'utf8')).toBe('keep');
});
test.skipIf(process.platform==='win32')('rejects symlink output directories without touching the target',async()=>{
 const outside=await mkdtemp(join(tmpdir(),'behavproof-test-outside-'));try{await writeFile(join(outside,'vitest.json'),'keep');await symlink(outside,join(root,'.behavproof'));expect(run().status).toBe(2);expect(await readFile(join(outside,'vitest.json'),'utf8')).toBe('keep');}finally{await rm(outside,{recursive:true,force:true});}
});
test('gate and dry-run flags cannot silently run tests as a successful gate',()=>{
 for(const flag of ['--mode=gate','--dry-run']){const result=spawnSync(process.execPath,[binary,'test',flag],{cwd:root,encoding:'utf8'});expect(result.status).toBe(2);}
});
test('rejects case-insensitive collisions between the two reporters',async()=>{
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,reports:{vitest:'.behavproof/input/CONTRACTS.JSON'}}));expect(run().status).toBe(2);
});
test('never deletes a selected config even when it is in the report directory',async()=>{
 await mkdir(join(root,'.behavproof/input'),{recursive:true});const path='.behavproof/input/vitest.json',content=JSON.stringify({schemaVersion:1,reports:{vitest:path}});await writeFile(join(root,path),content);const result=spawnSync(process.execPath,[binary,'test','--config',path],{cwd:root,encoding:'utf8',timeout:30000});expect(result.status).toBe(2);expect(await readFile(join(root,path),'utf8')).toBe(content);
});
