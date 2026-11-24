import {gitSubject} from '../../packages/adapter-reports/src/index.js';
import {localNativeAuthority} from '../fixtures/native-vitest.js';
import {expect, it} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

it('holds the protected exception scope when the candidate widens its caller list or removes a marker',async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'exception-gate-'));
  const root=join(scratch,'project'),host=join(scratch,'trust.json');
  const cli=resolve('packages/cli/dist/index.js');
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture',
    '-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  const fixture={
    id:'BP-214', defaultRule:'no-direct-import',
    target:{module:'src/exception.ts',exportName:'escape'},
    allowedCallers:['src/allowed.ts'], sources:['src/**/*.ts'],
    condition:{kind:'static',rule:'direct-call-scope'},
    rationaleRef:'https://github.com/acme/shop/issues/214',
  };
  const config={schemaVersion:2,profile:'basic',git:{base:'HEAD'},
    reports:{vitest:'.behavproof/vitest.json'},rules:{testResult:{severity:'off'}},exceptions:[fixture]};
  const write=(path:string,value:string)=>writeFile(join(root,path),value);
  const run=(...args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:10000});
  try{
    await mkdir(join(root,'src'),{recursive:true});
    await write('package.json',JSON.stringify({name:'fixture',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
    await write('behavproof.config.json',JSON.stringify(config));
    await write('src/exception.ts','/** @behavproof-exception BP-214 */\nexport function escape(){return 1;}');
    await write('src/allowed.ts',"import {escape} from './exception'; escape();");
    await write('src/outside.ts','export const noop=1;');
    git('init','-qb','main');git('add','.');git('commit','-qm','baseline');
    const commit=git('rev-parse','HEAD');
    const paths=git('ls-files').split('\n');
    const authority=await localNativeAuthority(root,await gitSubject(root,paths,commit,commit));
    await writeFile(host,JSON.stringify({
      schemaVersion:2,config,policy:{schemaVersion:1,profileVersion:'2',rules:{}},
      sourceCommit:commit,specifications:[],runner:authority.runner,
      inputs:['package.json','behavproof.config.json','src/**/*.ts'],configPaths:[],manifests:authority.manifests,
    }));
    const discovery=run('exceptions','discover');
    expect(discovery.status,discovery.stderr).toBe(0);
    expect(JSON.parse(discovery.stdout).exceptions).toContainEqual(expect.objectContaining({id:fixture.id}));
    const ok=run('check','--mode','gate','--trust-root',host,'--format','json');
    expect(ok.status,ok.stderr+ok.stdout).toBe(0);
    await write('src/exception.ts','export function escape(){return 1;}');
    await write('src/outside.ts',"import {escape as access} from './exception'; access();");
    await write('behavproof.config.json',JSON.stringify({...config,exceptions:[{...fixture,
      allowedCallers:[...fixture.allowedCallers,'src/outside.ts']}]}));
    git('add','.');git('commit','-qm','candidate widens scope');
    const bad=run('check','--mode','gate','--trust-root',host,'--format','json');
    expect(bad.status,bad.stderr+bad.stdout).toBe(1);
    const rows=JSON.parse(bad.stdout).evaluations;
    expect(rows).toContainEqual(expect.objectContaining({
      ruleId:'scopedException',status:'fail',scope:[fixture.id,'exception'],
    }));
    expect(rows).toContainEqual(expect.objectContaining({ruleId:'scopedExceptionApproval',status:'fail'}));

    await rm(join(root,'src/exception.ts'));
    git('add','.');git('commit','-qm','candidate removes target');
    const missing=run('check','--mode','gate','--trust-root',host,'--format','json');
    expect(missing.status,missing.stderr).toBe(1);
    expect(JSON.parse(missing.stdout).evaluations).toContainEqual(expect.objectContaining({
      ruleId:'scopedException',status:'unknown',
    }));
  }finally{await rm(scratch,{recursive:true,force:true});}
});
