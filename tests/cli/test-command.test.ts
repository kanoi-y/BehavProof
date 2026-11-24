import{beforeEach,afterEach,test,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm,symlink}from'node:fs/promises';
import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';
const project=resolve('.'),binary=join(project,'packages/cli/dist/index.js');let root:string;
const run=()=>spawnSync(process.execPath,[binary,'test'],{cwd:root,encoding:'utf8',timeout:30000});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof-test-command-'));await writeFile(join(root,'package.json'),JSON.stringify({name:'sample',type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');await mkdir(join(root,'tests'));await writeFile(join(root,'tests/example.test.ts'),"import{test,expect}from'vitest';test('doubles',()=>expect(2*2).toBe(4));\n");await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2}));});
afterEach(()=>rm(root,{recursive:true,force:true}));
test('Vitest replaces a successful result with a fresh failing report and receipt',async()=>{
 expect(run().status).toBe(0);
 const receipt=join(root,'.behavproof/input/vitest.json.receipt.json');
 await writeFile(receipt,'stale');
 await writeFile(join(root,'tests/example.test.ts'),"import{test,expect}from'vitest';test('fails',()=>expect(1).toBe(2));");
 const result=run();expect(result.status,result.stderr+result.stdout).toBe(1);
 expect(JSON.parse(await readFile(join(root,'.behavproof/input/vitest.json'),'utf8')).numFailedTests).toBe(1);
 expect(JSON.parse(await readFile(receipt,'utf8')).runner).toEqual({kind:'vitest',version:'5.1.0'});
});
test('respects configured Vitest report inside the managed directory',async()=>{
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,reports:{vitest:'.behavproof/custom/vitest.json'}}));const result=run();expect(result.status,result.stderr+result.stdout).toBe(0);expect(JSON.parse(await readFile(join(root,'.behavproof/custom/vitest.json'),'utf8')).numPassedTests).toBe(1);
});
test('refuses unmanaged output paths before deleting project files',async()=>{
 await writeFile(join(root,'source.json'),'keep');await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,reports:{vitest:'source.json'}}));expect(run().status).toBe(2);expect(await readFile(join(root,'source.json'),'utf8')).toBe('keep');
});
test.skipIf(process.platform==='win32')('rejects symlink output directories without touching the target',async()=>{
 const outside=await mkdtemp(join(tmpdir(),'behavproof-test-outside-'));try{await writeFile(join(outside,'vitest.json'),'keep');await symlink(outside,join(root,'.behavproof'));expect(run().status).toBe(2);expect(await readFile(join(outside,'vitest.json'),'utf8')).toBe('keep');}finally{await rm(outside,{recursive:true,force:true});}
});
test('gate and dry-run flags cannot silently run tests as a successful gate',()=>{
 for(const flag of ['--mode=gate','--dry-run']){const result=spawnSync(process.execPath,[binary,'test',flag],{cwd:root,encoding:'utf8'});expect(result.status).toBe(2);}
});
test('rejects the retired Contract execution configuration',async()=>{
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,contracts:{enabled:true}}));
 const result=run();expect(result.status).toBe(2);expect(result.stderr).toContain('Unrecognized key');
});
test('never deletes a selected config even when it is in the report directory',async()=>{
 await mkdir(join(root,'.behavproof/input'),{recursive:true});const path='.behavproof/input/vitest.json',content=JSON.stringify({schemaVersion:2,reports:{vitest:path}});await writeFile(join(root,path),content);const result=spawnSync(process.execPath,[binary,'test','--config',path],{cwd:root,encoding:'utf8',timeout:30000});expect(result.status).toBe(2);expect(await readFile(join(root,path),'utf8')).toBe(content);
});

test('captures a fresh runner receipt for an ordinary Vitest run', async () => {
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2}));
  await writeFile(join(root, 'tests/example.test.ts'), "import {test, expect} from 'vitest'; test('ordinary', () => expect(1).toBe(1));");
  const {evaluateTestEvidence} = await import('@behavproof/adapter-reports');
  const report = '.behavproof/input/vitest.json';
  let previous: string | undefined;
  for (let runNumber = 0; runNumber < 2; runNumber++) {
    const result = runNumber === 0 ? run() : spawnSync(process.execPath, [binary, 'test'], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: {...process.env, BEHAVPROOF_EXECUTION_ID: 'collector-selected'},
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const receipt = JSON.parse(await readFile(join(root, report + '.receipt.json'), 'utf8'));
    expect(receipt.invocation).not.toBe(previous);
    if (runNumber === 1) expect(receipt.invocation).toBe('collector-selected');
    expect(evaluateTestEvidence(await readFile(join(root, report)), receipt, {
      runner: {kind: 'vitest', version: '5.1.0'}, invocation: receipt.invocation, authenticated: true,
    }).status).toBe('pass');
    previous = receipt.invocation;
  }
  await writeFile(join(root, 'tests/example.test.ts'), "import {test, expect} from 'vitest'; test('ordinary', () => expect(1).toBe(2));");
  expect(run().status).toBe(1);
  const failed = JSON.parse(await readFile(join(root, report + '.receipt.json'), 'utf8'));
  expect(failed.invocation).not.toBe(previous);
  expect(evaluateTestEvidence(await readFile(join(root, report)), failed, {
    runner: {kind: 'vitest', version: '5.1.0'}, invocation: failed.invocation, authenticated: true,
  }).status).toBe('fail');
});
