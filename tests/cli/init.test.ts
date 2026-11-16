import {beforeEach,afterEach,test,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const binary=resolve('packages/cli/dist/index.js');let root:string;
const init=(...args:string[])=>spawnSync(process.execPath,[binary,'init',...args],{cwd:root,encoding:'utf8'});
const ignored=()=>spawnSync('git',['-c','core.fsmonitor=false','check-ignore','--no-index','--','.behavproof/report.json'],{cwd:root,encoding:'utf8'}).status===0;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof-init-'));await writeFile(join(root,'package.json'),JSON.stringify({name:'sample',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));const result=spawnSync('git',['init','-q'],{cwd:root,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);});
afterEach(()=>rm(root,{recursive:true,force:true}));
test('init creates the project gitignore and reruns without duplicates',async()=>{
 const first=init();expect(first.status,first.stderr).toBe(0);expect(JSON.parse(first.stdout).gitignore).toEqual({path:'.gitignore',action:'created'});
 expect(await readFile(join(root,'.gitignore'),'utf8')).toBe('.behavproof/\n');expect(ignored()).toBe(true);
 const second=init();expect(second.status,second.stderr).toBe(0);expect(JSON.parse(second.stdout).gitignore.action).toBe('preserve');expect(await readFile(join(root,'.gitignore'),'utf8')).toBe('.behavproof/\n');
});
test('dry-run describes both proposed files and writes neither',async()=>{
 const result=init('--dry-run');expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).gitignore.action).toBe('would-create');
 for(const path of ['.gitignore','behavproof.config.json'])await expect(readFile(join(root,path))).rejects.toThrow();
});
test.each([
 ['# Existing rules\nnode_modules/', '# Existing rules\nnode_modules/\n.behavproof/\n'],
 ['# Existing rules\r\nnode_modules/\r\n','# Existing rules\r\nnode_modules/\r\n.behavproof/\r\n'],
 ['# .behavproof/ is mentioned in a comment\n','# .behavproof/ is mentioned in a comment\n.behavproof/\n'],
])('appends while preserving existing bytes: %s',async(before,after)=>{
 await writeFile(join(root,'.gitignore'),before);const dry=init('--dry-run');expect(dry.status,dry.stderr).toBe(0);expect(JSON.parse(dry.stdout).gitignore.action).toBe('would-update');expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(before);
 const result=init();expect(result.status,result.stderr).toBe(0);expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(after);expect(ignored()).toBe(true);
});
test.each(['.behavproof/','/.behavproof/','.behavproof','/.behavproof'])('preserves existing effective rule %s',async rule=>{
 const before=`# Keep this\n${rule}\ncoverage/\n`;await writeFile(join(root,'.gitignore'),before);expect(init().status).toBe(0);expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(before);expect(ignored()).toBe(true);
});
test('a later negation is retained and followed by an effective ignore rule',async()=>{
 const before='/.behavproof/\n!/*\n';await writeFile(join(root,'.gitignore'),before);expect(ignored()).toBe(false);expect(init().status).toBe(0);expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(before+'.behavproof/\n');expect(ignored()).toBe(true);
});
test('existing custom config is preserved while gitignore is repaired',async()=>{
 const config='{"schemaVersion":1,"profile":"critical"}\n';await writeFile(join(root,'custom.json'),config);const result=init('--config','custom.json');expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).action).toBe('preserve');expect(await readFile(join(root,'custom.json'),'utf8')).toBe(config);expect(ignored()).toBe(true);
});
test.skipIf(process.platform==='win32')('refuses a symlink gitignore without changing its target or creating config',async()=>{
 const target=join(root,'original.txt');await writeFile(target,'keep\n');await symlink(target,join(root,'.gitignore'));const result=init();expect(result.status).toBe(2);expect(await readFile(target,'utf8')).toBe('keep\n');await expect(readFile(join(root,'behavproof.config.json'))).rejects.toThrow();
});
test('refuses a hardlinked gitignore before creating config',async()=>{
 const target=join(root,'original.txt');await writeFile(target,'keep\n');await link(target,join(root,'.gitignore'));const result=init();expect(result.status).toBe(2);expect(await readFile(target,'utf8')).toBe('keep\n');await expect(readFile(join(root,'behavproof.config.json'))).rejects.toThrow();
});
test('rejects using the managed gitignore path as the config destination',async()=>{
 expect(init('--config','.gitignore').status).toBe(2);await expect(readFile(join(root,'.gitignore'))).rejects.toThrow();
});
test('init also works before git init and remains idempotent',async()=>{
 await rm(join(root,'.git'),{recursive:true,force:true});expect(init().status).toBe(0);expect(init().status).toBe(0);expect(await readFile(join(root,'.gitignore'),'utf8')).toBe('.behavproof/\n');
});
test('an ignore rule followed by a negation is repaired even before git init',async()=>{
 await rm(join(root,'.git'),{recursive:true,force:true});const before='.behavproof/\n!/*\n';await writeFile(join(root,'.gitignore'),before);expect(init().status).toBe(0);spawnSync('git',['init','-q'],{cwd:root});expect(ignored()).toBe(true);
});
test('ignoring one probe must not leave JSON artifacts exposed by later negations',async()=>{
 const before='.behavproof/\n*\n!*/\n!*.json\n';await writeFile(join(root,'.gitignore'),before);expect(ignored()).toBe(false);
 const result=init();expect(result.status,result.stderr).toBe(0);expect(ignored()).toBe(true);expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(before+'.behavproof/\n');
});
test('unrelated later negations do not cause duplicate directory rules',async()=>{
 const before='.behavproof/\n!README.md\n';await writeFile(join(root,'.gitignore'),before);const result=init();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).gitignore.action).toBe('preserve');expect(await readFile(join(root,'.gitignore'),'utf8')).toBe(before);expect(ignored()).toBe(true);
});
test.each(['.behavproof/\n','.behavproof/\n!README.md\n'])('init remains idempotent inside a directory ignored by its parent repo: %s',async content=>{
 const {mkdir}=await import('node:fs/promises');const nested=join(root,'nested');await mkdir(nested);await writeFile(join(root,'.gitignore'),'nested/\n');await writeFile(join(nested,'package.json'),JSON.stringify({name:'nested',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));await writeFile(join(nested,'.gitignore'),content);
 for(let attempt=0;attempt<2;attempt++){const result=init('--root',nested);expect(result.status,result.stderr).toBe(0);expect(await readFile(join(nested,'.gitignore'),'utf8')).toBe(content);}
});
test.each(['.behavproof/\n*\n!*/\n!*.json\n','.behavproof/\n*\n!/.behavproof/\n!*.json\n','.behavproof/\n*\n!/.behavproof*/\n!*.json\n','.behavproof/\n*\n!/.behavproo?/\n!*.json\n'])('a nested package local wildcard must not be mistaken for an ignored parent directory: %s',async before=>{
 const {mkdir}=await import('node:fs/promises');const nested=join(root,'nested');await mkdir(nested);await writeFile(join(nested,'package.json'),JSON.stringify({name:'nested',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));await writeFile(join(nested,'.gitignore'),before);
 const probe=()=>spawnSync('git',['check-ignore','--no-index','--','.behavproof/report.json'],{cwd:nested}).status;
 expect(probe()).toBe(1);const result=init('--root',nested);expect(result.status,result.stderr).toBe(0);expect(probe()).toBe(0);expect(await readFile(join(nested,'.gitignore'),'utf8')).toBe(before+'.behavproof/\n');
});
