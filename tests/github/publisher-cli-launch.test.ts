import {test,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,cp,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';

// Catches a publisher that passes static diagnosis but cannot launch its real CLI
// after npm installs a workspace whose compiled bin did not exist at install time.
test.skipIf(process.platform==='win32')('protected publisher launches the real CLI after a clean install before compilation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-publisher-launch-'));
 const run=(command:string,args:string[],env=process.env)=>spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:30000});
 try{
  const cli=JSON.parse(await readFile('packages/cli/package.json','utf8'));
  await mkdir(join(root,'packages/cli'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,workspaces:['packages/*']}));
  await writeFile(join(root,'packages/cli/package.json'),JSON.stringify({name:cli.name,version:cli.version,type:'module',bin:cli.bin}));
  for(const args of [['install','--package-lock-only','--ignore-scripts','--offline'],['ci','--ignore-scripts','--offline']]){
   const result=run('npm',args);expect(result.status,result.stderr).toBe(0);
  }
  // Compilation creates the entry only after installation, as in the workflow.
  await cp('packages/cli/dist',join(root,'packages/cli/dist'),{recursive:true});
  await symlink(resolve('node_modules'),join(root,'packages/cli/node_modules'));
  const workflow=parse(await readFile('templates/protected-github-publisher.yml','utf8'));
  const steps=workflow.jobs.gate.steps;
  const build=steps.findIndex((s:any)=>s.run==='npm run build');
  const app=steps.findIndex((s:any)=>s.id==='app');
  expect(build).toBeGreaterThan(-1);expect(app).toBeGreaterThan(build);
  const githubPath=join(root,'github-path');await writeFile(githubPath,'');
  let env={...process.env,GITHUB_PATH:githubPath};
  for(const step of steps.slice(build+1,app))if(step.run){
   const result=run('bash',['-e','-c',step.run],env);expect(result.status,result.stderr).toBe(0);
   const paths=(await readFile(githubPath,'utf8')).trim().split('\n').filter(Boolean);
   env={...env,PATH:[...paths,process.env.PATH].join(':')};
  }
  const result=run('bash',['-e','-c','behavproof --help'],env);
  expect(result.status,result.stderr).toBe(0);
  expect(await realpath(join(root,'node_modules/.bin/behavproof'))).toBe(await realpath(join(root,'packages/cli/dist/index.js')));
  expect(result.stdout).toMatch(/^BehavProof /);
 }finally{await rm(root,{recursive:true,force:true});}
},60000);
