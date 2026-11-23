import {expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {evaluateTestEvidence} from '../../packages/adapter-reports/src/index.js';

const require=createRequire(import.meta.url);
const cli=resolve('packages/cli/dist/index.js');
it.each([['jest','30.5.2'],['vitest','5.1.0']] as const)(
  'collects %s evidence in a consumer without a Contract SDK',async (kind,version)=>{
    const root=await mkdtemp(join(tmpdir(),'behavproof-native-reporter-'));
    try{
      await mkdir(join(root,'tests'));
      await mkdir(join(root,'node_modules'));
      await symlink(dirname(require.resolve(kind+'/package.json')),join(root,'node_modules',kind),
        process.platform==='win32'?'junction':'dir');
      const sample=kind==='jest'?'test("ordinary",()=>expect(1).toBe(1));':
        'import {test,expect,describe} from "vitest"; describe("nested",()=>test("ordinary",()=>expect(1).toBe(1)));';
      await writeFile(join(root,'tests/sample.test.'+(kind==='jest'?'cjs':'mjs')),sample);
      await writeFile(join(root,'package.json'),JSON.stringify({name:'consumer',type:'module',
        devDependencies:{[kind]:version}}));
      const output=spawnSync(process.execPath,[cli,'test'],{cwd:root,encoding:'utf8',timeout:15000});
      expect(output.status,output.stdout+output.stderr).toBe(0);
      const nativeRef=join(root,'.behavproof/input',kind+'.json');
      const receipt=JSON.parse(await readFile(nativeRef+'.receipt.json','utf8'));
      expect(evaluateTestEvidence(await readFile(nativeRef),receipt,{
        invocation:receipt.invocation,runner:{kind,version},authenticated:true,
      }).status).toBe('pass');
      await expect(readFile(join(root,'.behavproof/input/contracts.json'))).rejects.toMatchObject({code:'ENOENT'});
    }finally{await rm(root,{recursive:true,force:true});}
  },
);
