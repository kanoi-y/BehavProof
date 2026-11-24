import{beforeEach,afterEach,it,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';
const sdk=resolve('.'),cli=join(sdk,'packages/cli/dist/index.js');let root:string;
const invoke=(...args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:30000});
const correct="test('doubles',()=>expect(2*2).toBe(4));";
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'jest-cli-'));spawnSync('git',['init','-q'],{cwd:root});await mkdir(join(root,'tests'));await symlink(join(sdk,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');await writeFile(join(root,'package.json'),JSON.stringify({name:'jest-consumer',type:'commonjs',devDependencies:{jest:'30.5.2'},scripts:{test:'jest'}}));await writeFile(join(root,'jest.config.cjs'),"module.exports={testEnvironment:'node',testMatch:['**/tests/*.test.cjs'],watchman:false};");await writeFile(join(root,'tests/sample.test.cjs'),correct);await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2}));});
afterEach(async()=>rm(root,{recursive:true,force:true}));
it('Jest replaces a successful result with a fresh failing report and receipt',async()=>{
 expect(invoke('test').status).toBe(0);
 const receipt=join(root,'.behavproof/input/jest.json.receipt.json');
 await writeFile(receipt,'stale');
 await writeFile(join(root,'tests/sample.test.cjs'),correct.replace('2*2','2*3'));
 const result=invoke('test');expect(result.status,result.stderr+result.stdout).toBe(1);
 expect(JSON.parse(await readFile(join(root,'.behavproof/input/jest.json'),'utf8')).numFailedTests).toBe(1);
 expect(JSON.parse(await readFile(receipt,'utf8')).runner).toEqual({kind:'jest',version:'30.5.2'});
});
it('requires an explicit runner with both dependencies and honors configured selection',async()=>{const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));pkg.devDependencies.vitest='5.1.0';await writeFile(join(root,'package.json'),JSON.stringify(pkg));expect(invoke('test').status).toBe(2);expect(invoke('test','--runner','jest').status).toBe(0);await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,testRunner:'jest',reports:{jest:'.behavproof/custom/jest.json'}}));expect(invoke('test').status).toBe(0);expect(JSON.parse(await readFile(join(root,'.behavproof/custom/jest.json'),'utf8')).success).toBe(true);});
it('refuses unmanaged or colliding output before deleting project files',async()=>{await writeFile(join(root,'source.json'),'preserve');for(const output of ['source.json','.behavproof']){await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,testRunner:'jest',reports:{jest:output}}));expect(invoke('test').status).toBe(2);expect(await readFile(join(root,'source.json'),'utf8')).toBe('preserve');}});
it('initializes Jest report paths and diagnoses the project without executing its configuration',async()=>{
 await rm(join(root,'behavproof.config.json'));await writeFile(join(root,'jest.config.cjs'),"throw Error('doctor/init must not load this');");const init=invoke('init');expect(init.status,init.stderr).toBe(0);const cfg=JSON.parse(await readFile(join(root,'behavproof.config.json'),'utf8'));expect(cfg).toMatchObject({testRunner:'jest',reports:{jest:'.behavproof/input/jest.json'}});expect(cfg.reports).not.toHaveProperty('vitest');const doctor=invoke('doctor');expect(doctor.status,doctor.stderr+doctor.stdout).toBe(0);});
it('does not silently overwrite incompatible custom test runners or run gate flags',async()=>{await writeFile(join(root,'jest.config.cjs'),"module.exports={testRunner:require.resolve('jest-jasmine2'),testMatch:['**/tests/*.test.cjs']};");expect(invoke('test').status).toBe(2);for(const flag of ['--mode=gate','--dry-run'])expect(invoke('test','--runner','jest',flag).status).toBe(2);});

it('captures runner evidence for an ordinary Jest run', async () => {
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2}));
  await writeFile(join(root, 'tests/sample.test.cjs'), "test('ordinary', () => expect(1).toBe(1));");
  const result = invoke('test');
  expect(result.status, result.stderr + result.stdout).toBe(0);
  const {evaluateTestEvidence} = await import('@behavproof/adapter-reports');
  const report = '.behavproof/input/jest.json';
  const receipt = JSON.parse(await readFile(join(root, report + '.receipt.json'), 'utf8'));
  expect(evaluateTestEvidence(await readFile(join(root, report)), receipt, {
    runner: {kind: 'jest', version: '30.5.2'}, invocation: receipt.invocation, authenticated: true,
  }).status).toBe('pass');
});
